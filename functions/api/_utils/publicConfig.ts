// Shared response-building logic for the public, UNAUTHENTICATED
// dashboard config read - GET .../config -> { runwayGroups, theme,
// cameraSlots, carouselSlots, opsPanel }. Extracted from
// functions/api/public/[tenant]/config.ts (the original slug-based
// route) so functions/api/public/config.ts (the new host-based route,
// Stage 3) can share the exact same query/response shape instead of a
// second copy to keep in sync. Both routes just resolve organizationId
// differently (URL path segment vs. Host header) and hand it to this.
//
// Parent/sub-tenant round: runway_groups and gas_prices are read from
// the EFFECTIVE tenant (tenants.parent_tenant_id, migration 0059) - a
// linked sub-tenant's dashboard shows a read-time mirror of its
// parent's rows for both, never writing/overwriting anything. Falls
// back to the sub-tenant's OWN stored rows if the parent itself has
// none (e.g. a parent that's never touched Runway Groups or Gas
// Prices) - found during this round's own edge-case testing: without
// this, a linked sub-tenant with perfectly good onboarding-template
// data of its own would show a blank runway diagram / empty gas panel
// just because the parent happened to have nothing, which is worse
// than showing its own values were. Same "never a broken/blank read"
// posture as resolveParentTenant.ts's own dangling-parent fallback and
// opsPanel's own per-field fallback below - see ownRunwayRows/
// ownGasPricesRow and their use further down. ops_panel_state is
// deliberately NOT switched wholesale onto the effective tenant the
// same way - that single row also holds safetyNotices/airfieldInfoText/
// showAutoNotams/weatherSummaryChart settings, which stay tenant-local
// per explicit instruction (clubhouse notices are never inherited).
// Only activeRunwayEnd/circuitDirection are pulled from the parent and
// spliced into the tenant's own otherwise-unchanged opsPanel object -
// see the dedicated parentOpsPanelRow query and its use below.
// Everything else in this file (theme, tenant branding/name/logo,
// camera_slots, cameras, carouselSlots, cafeCarouselSlots,
// cafeSettings) stays keyed by the tenant's own organizationId,
// completely unaffected - a sub-tenant's own identity/media/layout
// choices are never the parent's.

import { resolveEffectiveTenantByOrganizationId } from "./resolveParentTenant";

export type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results: T[] }>;
    };
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
};

export interface PublicConfigEnv {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

interface RunwayGroupRow {
  id: string;
  endAIdentifier: string;
  endBIdentifier: string;
  headingDegrees: number;
  twin: number;
  stripLengthPx: number;
  identifierFontSizePx: number;
  stripsJson: string;
  sortOrder: number;
}

interface CameraSlotRow {
  slotNumber: number;
  label: string;
  url: string;
}

// New tenant cameras (migration 0047) - deliberately separate from
// camera_slots above (see that migration's own comment). Exposed here,
// publicly, with the exact same posture camera_slots already has: these
// URLs are embedded as iframes on the unauthenticated dashboard anyway,
// so this is not a new exposure - rtsp_address is never selected here
// or anywhere in this file.
interface CameraRow {
  id: string;
  label: string;
  mode: string;
  youtubeVideoId: string | null;
  localBaseUrl: string | null;
}

// Mirrors functions/api/public/cameras.ts's own localStreamUrl
// construction exactly (go2rtc's built-in stream page, camera id as the
// stream name by convention) - duplicated rather than imported, this
// repo's established functions/src boundary convention. Stream mode
// prefers the YouTube embed; local/both prefer the relay's own local
// address, matching CameraPanel.tsx's own "try local first" default for
// 'both'.
function resolveCameraUrl(mode: string, youtubeVideoId: string | null, localBaseUrl: string | null, cameraId: string): string | null {
  if (mode === "stream") {
    return youtubeVideoId ? `https://www.youtube.com/embed/${youtubeVideoId}` : null;
  }
  return localBaseUrl ? `${localBaseUrl}/stream.html?src=${encodeURIComponent(cameraId)}` : null;
}

interface CarouselSlotResolvedRow {
  slotNumber: number;
  mediaType: string;
  durationSeconds: number;
  mp4DurationSeconds: number | null;
  resolvedUrl: string | null;
  fitMode: string;
  cropRect: { x: number; y: number; width: number; height: number };
  rotationDegrees: number;
  brightnessPercent: number;
  bannerText: string;
  bannerOpacity: number;
  bannerFontSize: string;
  zone: string;
}

interface OpsPanelRow {
  activeRunwayEnd: string;
  circuitDirection: string;
  airfieldInfoText: string;
  safetyNoticesJson: string;
  showAutoNotams: number;
  notamsCarouselIntervalSeconds: number;
  reverseCompassNeedle: number;
  weatherSummaryChartEnabled: number;
  weatherSummaryStateADurationSeconds: number;
  weatherSummaryStateBDurationSeconds: number;
  runwaysClosed: number;
}

// Dedicated Gas Prices store (migration 0049) - deliberately separate
// from OpsPanelRow/safetyNoticesJson above, see that migration's own
// comment. Missing row (a tenant that's never touched Dashboard
// Manager's Gas Prices container) resolves to all-null prices below,
// same "no sensible default, so don't show a fake one" posture as
// airfieldInfoText.
interface GasPricesRow {
  avgasPrice: number | null;
  ul91Price: number | null;
  jetA1Price: number | null;
  currency: string;
}

// Migration 0039 - independent logo/name display settings for the two
// places a tenant's branding badge renders (Header.tsx on the
// dashboard-style templates, VenueCornerBadge.tsx on the Café
// template). Duplicated (not imported) in tenant/config.ts - this
// repo's own established convention of not sharing types across the
// functions/src boundary (see e.g. SafetyNotice, duplicated privately
// in three places already).
interface BrandDisplaySettings {
  showLogo: boolean;
  showName: boolean;
  nameFontSize: "sm" | "md" | "lg" | "xl";
}

interface BrandDisplayConfig {
  main: BrandDisplaySettings;
  cafe: BrandDisplaySettings;
}

const DEFAULT_BRAND_DISPLAY: BrandDisplayConfig = {
  main: { showLogo: true, showName: true, nameFontSize: "md" },
  cafe: { showLogo: true, showName: true, nameFontSize: "md" },
};

// Tolerates a missing/malformed column value (shouldn't happen given
// the migration's own NOT NULL DEFAULT, but a parse failure here must
// never break the whole public config response) by falling back to
// today's unconditional "show both, medium size" behaviour.
function parseBrandDisplay(json: string | null | undefined): BrandDisplayConfig {
  if (!json) return DEFAULT_BRAND_DISPLAY;
  try {
    const parsed = JSON.parse(json);
    return {
      main: { ...DEFAULT_BRAND_DISPLAY.main, ...(parsed?.main ?? {}) },
      cafe: { ...DEFAULT_BRAND_DISPLAY.cafe, ...(parsed?.cafe ?? {}) },
    };
  } catch {
    return DEFAULT_BRAND_DISPLAY;
  }
}

interface SafetyNoticeResolved {
  id: string;
  name: string;
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  enabled: boolean;
}

interface CafeSettingsRow {
  layoutMode: string;
  adLabelEnabled: number;
  tickerEnabled: number;
  tickerSlotsJson: string;
  tickerBackgroundColor: string;
  tickerBackgroundOpacity: number;
  tickerHeightPx: number;
  tickerFontFamily: string;
  tickerFontSizePx: number;
  tickerFontColor: string;
  tickerScrollSpeedPxPerSec: number;
  tickerGapPx: number;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Split from buildPublicConfigResponse below (this round) so
// functions/api/tenant/config.ts's session-scoped route can merge
// carouselSlots/cafeCarouselSlots/opsPanel into its OWN response using
// the exact same query/mapping logic, instead of a second copy to keep
// in sync - the SQL here (especially the media_library JOIN and the
// resolvedUrl cache-busting logic) is exactly the kind of thing that
// silently drifts between two hand-maintained copies. Every existing
// caller of buildPublicConfigResponse is unaffected - that function
// below is now a thin wrapper over this one.
export async function buildPublicConfigData(organizationId: string, env: PublicConfigEnv) {
  // One resolution, reused by runway_groups/gas_prices below and by the
  // parentOpsPanelRow query further down - see this file's own top
  // comment for exactly which domains use `effective` vs the tenant's
  // own `organizationId`.
  const effective = await resolveEffectiveTenantByOrganizationId(env.DB, organizationId);

  const [runwayRows, themeRow, tenantRow, cameraRows, newCameraRows, carouselRows, cafeCarouselRows, opsPanelRow, mainDisplayRow, cafeSettingsRow, gasPricesRow, parentOpsPanelRow, ownRunwayRows, ownGasPricesRow] = await Promise.all([
    env.DB
      .prepare("SELECT id, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
      .bind(effective.organizationId)
      .all<RunwayGroupRow>(),
    env.DB.prepare("SELECT tokensJson FROM club_theme WHERE organizationId = ?").bind(organizationId).first<{ tokensJson: string }>(),
    // Real tenant display name (tenants.name) - was previously not part
    // of this response at all; Header.tsx hardcoded "SHOBDON AIRFIELD"
    // literally, since there was no per-tenant name flowing to the
    // public dashboard anywhere. Found during the pre-onboarding
    // branding audit. logo_r2_key resolved to logoUrl below, same
    // pattern as carouselSlots[].resolvedUrl.
    env.DB
      .prepare(
        "SELECT name, logo_r2_key AS logoR2Key, has_physical_atc AS hasPhysicalAtc, brand_display_json AS brandDisplayJson FROM tenants WHERE organization_id = ?"
      )
      .bind(organizationId)
      .first<{ name: string; logoR2Key: string | null; hasPhysicalAtc: number; brandDisplayJson: string | null }>(),
    env.DB
      .prepare("SELECT slotNumber, label, url FROM camera_slots WHERE organizationId = ? ORDER BY slotNumber")
      .bind(organizationId)
      .all<CameraSlotRow>(),
    // New tenant cameras (migration 0047) - tenant_id-keyed (not
    // organizationId, unlike every other table in this file), matching
    // the tenant_api_keys/weather_observations convention instead. The
    // inline subquery avoids needing tenantRow's own result first
    // (these all run in one Promise.all, so nothing here can depend on
    // another query's resolved value).
    env.DB
      .prepare(
        `SELECT c.id, c.name AS label, c.mode, c.youtube_video_id AS youtubeVideoId, r.local_base_url AS localBaseUrl
         FROM cameras c JOIN site_relays r ON r.id = c.site_relay_id
         WHERE c.tenant_id = (SELECT id FROM tenants WHERE organization_id = ?)
         ORDER BY c.created_at`
      )
      .bind(organizationId)
      .all<CameraRow>(),
    env.DB
      .prepare(
        `SELECT
           cs.slotNumber AS slotNumber,
           cs.mediaType AS mediaType,
           cs.durationSeconds AS durationSeconds,
           cs.fitMode AS fitMode,
           cs.cropX AS cropX,
           cs.cropY AS cropY,
           cs.cropWidth AS cropWidth,
           cs.cropHeight AS cropHeight,
           cs.rotationDegrees AS rotationDegrees,
           cs.brightnessPercent AS brightnessPercent,
           cs.bannerText AS bannerText,
           cs.bannerOpacity AS bannerOpacity,
           cs.bannerFontSize AS bannerFontSize,
           cs.zone AS zone,
           ml.mp4DurationSeconds AS mp4DurationSeconds,
           ml.r2Key AS r2Key,
           ml.uploadedAt AS mediaUploadedAt,
           cam.url AS cameraUrl,
           nc.mode AS newCameraMode,
           nc.youtube_video_id AS newCameraYoutubeVideoId,
           nsr.local_base_url AS newCameraLocalBaseUrl,
           cs.cameraId AS newCameraId
         FROM carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         LEFT JOIN camera_slots cam ON cam.organizationId = cs.organizationId AND cam.slotNumber = cs.cameraSlotNumber
         LEFT JOIN cameras nc ON nc.id = cs.cameraId
         LEFT JOIN site_relays nsr ON nsr.id = nc.site_relay_id
         WHERE cs.organizationId = ? AND cs.enabled = 1
         ORDER BY cs.slotNumber`
      )
      .bind(organizationId)
      .all<{
        slotNumber: number;
        mediaType: string;
        durationSeconds: number;
        fitMode: string;
        cropX: number;
        cropY: number;
        cropWidth: number;
        cropHeight: number;
        rotationDegrees: number;
        brightnessPercent: number;
        bannerText: string;
        bannerOpacity: number;
        bannerFontSize: string;
        zone: string;
        mp4DurationSeconds: number | null;
        r2Key: string | null;
        mediaUploadedAt: string | null;
        cameraUrl: string | null;
        newCameraMode: string | null;
        newCameraYoutubeVideoId: string | null;
        newCameraLocalBaseUrl: string | null;
        newCameraId: string | null;
      }>(),
    // Café's own slot set (migration 0037, cafe_carousel_slots) - same
    // query shape as the dashboard's carouselRows above, pointed at the
    // separate table. Read unconditionally regardless of mainTemplateId
    // (same posture as carouselRows itself, and as opsPanel/cafeSettings
    // below) - CafeTemplate.tsx is the only consumer that will actually
    // request this data via MediaPanel's slotSource="cafe" prop, so an
    // unused query result for a tenant not currently on the café
    // template costs one extra (cheap, indexed) SELECT, not a real
    // problem, and keeps this function's own logic template-agnostic.
    env.DB
      .prepare(
        `SELECT
           cs.slotNumber AS slotNumber,
           cs.mediaType AS mediaType,
           cs.durationSeconds AS durationSeconds,
           cs.fitMode AS fitMode,
           cs.cropX AS cropX,
           cs.cropY AS cropY,
           cs.cropWidth AS cropWidth,
           cs.cropHeight AS cropHeight,
           cs.rotationDegrees AS rotationDegrees,
           cs.brightnessPercent AS brightnessPercent,
           cs.bannerText AS bannerText,
           cs.bannerOpacity AS bannerOpacity,
           cs.bannerFontSize AS bannerFontSize,
           cs.zone AS zone,
           ml.mp4DurationSeconds AS mp4DurationSeconds,
           ml.r2Key AS r2Key,
           ml.uploadedAt AS mediaUploadedAt,
           cam.url AS cameraUrl,
           nc.mode AS newCameraMode,
           nc.youtube_video_id AS newCameraYoutubeVideoId,
           nsr.local_base_url AS newCameraLocalBaseUrl,
           cs.cameraId AS newCameraId
         FROM cafe_carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         LEFT JOIN camera_slots cam ON cam.organizationId = cs.organizationId AND cam.slotNumber = cs.cameraSlotNumber
         LEFT JOIN cameras nc ON nc.id = cs.cameraId
         LEFT JOIN site_relays nsr ON nsr.id = nc.site_relay_id
         WHERE cs.organizationId = ? AND cs.enabled = 1
         ORDER BY cs.slotNumber`
      )
      .bind(organizationId)
      .all<{
        slotNumber: number;
        mediaType: string;
        durationSeconds: number;
        fitMode: string;
        cropX: number;
        cropY: number;
        cropWidth: number;
        cropHeight: number;
        rotationDegrees: number;
        brightnessPercent: number;
        bannerText: string;
        bannerOpacity: number;
        bannerFontSize: string;
        zone: string;
        mp4DurationSeconds: number | null;
        r2Key: string | null;
        mediaUploadedAt: string | null;
        cameraUrl: string | null;
        newCameraMode: string | null;
        newCameraYoutubeVideoId: string | null;
        newCameraLocalBaseUrl: string | null;
        newCameraId: string | null;
      }>(),
    env.DB
      .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, reverseCompassNeedle, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds, runwaysClosed FROM ops_panel_state WHERE organizationId = ?")
      .bind(organizationId)
      .first<OpsPanelRow>(),
    // Which dashboard template renders at "/" for this tenant - the
    // tenant_displays 'main' row (migration 0027, already used by
    // /d/:slug). Missing row (e.g. newcustomer, or any tenant that's
    // never touched the Dashboard Layout selector) must never 404 here -
    // "/" always has a template, defaulting to 'classic' (Clubhouse
    // Template 1), unlike /api/public/display's strict 404 for named
    // displays. `active` (migration 0034, Part D) is the one exception:
    // a developer can still force '/' itself off for support/
    // maintenance, same as any named display - DashboardPage.tsx reads
    // mainDisplayActive below and shows TenantUnavailable, mirroring
    // exactly how a paused tenant already does.
    env.DB
      .prepare(
        "SELECT td.template_id AS templateId, td.active AS active FROM tenant_displays td JOIN tenants t ON t.id = td.tenant_id WHERE t.organization_id = ? AND td.slug = 'main'"
      )
      .bind(organizationId)
      .first<{ templateId: string; active: number }>(),
    // Café template's own settings (migration 0033, style columns added
    // in 0035) - missing row (a tenant that's never visited /cafe-media)
    // must never 404 here, same "/" resilience posture as mainTemplateId
    // above - defaults applied below match cafe-settings/index.ts's own
    // defaultSettings().
    env.DB
      .prepare(
        `SELECT layoutMode, adLabelEnabled, tickerEnabled, tickerSlotsJson,
                tickerBackgroundColor, tickerBackgroundOpacity, tickerHeightPx, tickerFontFamily,
                tickerFontSizePx, tickerFontColor, tickerScrollSpeedPxPerSec, tickerGapPx
         FROM cafe_template_settings WHERE organizationId = ?`
      )
      .bind(organizationId)
      .first<CafeSettingsRow>(),
    env.DB
      .prepare("SELECT avgasPrice, ul91Price, jetA1Price, currency FROM gas_prices WHERE organizationId = ?")
      .bind(effective.organizationId)
      .first<GasPricesRow>(),
    // Parent's own activeRunwayEnd/circuitDirection ONLY - deliberately
    // not the parent's full ops_panel_state row, which would also pull
    // in the parent's safetyNotices/airfieldInfoText/display settings.
    // Skipped entirely (no query at all) for the common unlinked case -
    // Promise.resolve(null) rather than a real SELECT nobody needs.
    effective.isInherited
      ? env.DB
          .prepare("SELECT activeRunwayEnd, circuitDirection FROM ops_panel_state WHERE organizationId = ?")
          .bind(effective.organizationId)
          .first<{ activeRunwayEnd: string; circuitDirection: string }>()
      : Promise.resolve(null),
    // Fallback source for runwayGroups/gasPrices below, ONLY needed when
    // linked (unlinked already reads its own organizationId directly
    // above) - queried unconditionally alongside the parent's own rows
    // rather than as a conditional second round-trip after seeing the
    // parent's rows come back empty, same "one extra cheap indexed
    // SELECT is fine" posture as this file's own cafe_carousel_slots
    // query takes. Not used at all, and cheap to discard, for the
    // common case where the parent DOES have its own data.
    effective.isInherited
      ? env.DB
          .prepare("SELECT id, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
          .bind(organizationId)
          .all<RunwayGroupRow>()
      : Promise.resolve(null),
    effective.isInherited
      ? env.DB
          .prepare("SELECT avgasPrice, ul91Price, jetA1Price, currency FROM gas_prices WHERE organizationId = ?")
          .bind(organizationId)
          .first<GasPricesRow>()
      : Promise.resolve(null),
  ]);

  // Parent linked but has zero runway_groups/gas_prices rows of its own
  // (e.g. never touched those admin pages) -> fall back to the
  // sub-tenant's own stored rows rather than showing blank/null, per
  // this file's own top comment. Unlinked case is unaffected: runwayRows/
  // gasPricesRow above were already queried against the tenant's own
  // organizationId (effective.organizationId === organizationId), so
  // these checks never trigger.
  const effectiveRunwayRows = effective.isInherited && runwayRows.results.length === 0 ? (ownRunwayRows?.results ?? []) : runwayRows.results;
  const effectiveGasPricesRow = effective.isInherited && !gasPricesRow ? ownGasPricesRow : gasPricesRow;

  const runwayGroups = effectiveRunwayRows.map((row) => ({
    id: row.id,
    endAIdentifier: row.endAIdentifier,
    endBIdentifier: row.endBIdentifier,
    headingDegrees: row.headingDegrees,
    twin: !!row.twin,
    stripLengthPx: row.stripLengthPx,
    identifierFontSizePx: row.identifierFontSizePx,
    strips: JSON.parse(row.stripsJson),
  }));

  const theme = themeRow ? JSON.parse(themeRow.tokensJson) : null;
  const airfieldName = tenantRow?.name ?? null;
  const logoUrl = tenantRow?.logoR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${tenantRow.logoR2Key}` : null;
  const hasPhysicalAtc = !!tenantRow?.hasPhysicalAtc;
  const brandDisplay = parseBrandDisplay(tenantRow?.brandDisplayJson);

  const cameraSlots = cameraRows.results.map((row) => ({
    slot: row.slotNumber,
    label: row.label,
    url: row.url,
  }));

  // New tenant cameras (migration 0047) - same {label, url} shape as
  // cameraSlots above plus id (a string, unlike cameraSlots' numeric
  // slot), so CarouselSlotEditor.tsx's Webcams dropdown can offer both
  // lists side by side without the frontend needing to know which
  // table either option actually came from.
  const cameras = newCameraRows.results.map((row) => ({
    id: row.id,
    label: row.label,
    url: resolveCameraUrl(row.mode, row.youtubeVideoId, row.localBaseUrl, row.id),
  }));

  const mediaBaseUrl = env.MEDIA_PUBLIC_BASE_URL;
  const carouselSlots: CarouselSlotResolvedRow[] = carouselRows.results.map((row) => ({
    slotNumber: row.slotNumber,
    mediaType: row.mediaType,
    durationSeconds: row.durationSeconds,
    mp4DurationSeconds: row.mp4DurationSeconds,
    fitMode: row.fitMode,
    cropRect: { x: row.cropX, y: row.cropY, width: row.cropWidth, height: row.cropHeight },
    rotationDegrees: row.rotationDegrees,
    brightnessPercent: row.brightnessPercent,
    bannerText: row.bannerText,
    bannerOpacity: row.bannerOpacity,
    bannerFontSize: row.bannerFontSize,
    zone: row.zone,
    // The ?v= cache-buster matters now that a slide can be edited IN
    // PLACE (same r2Key, new bytes) - without it, a browser or the R2
    // public bucket's own edge caching could keep serving the pre-edit
    // image indefinitely even though the underlying object has
    // genuinely changed. mediaUploadedAt changes on every in-place
    // edit (see [id]/replace.ts), so appending it forces a fresh fetch
    // exactly when the content actually changed, and never otherwise.
    // newCameraId set means this slot points at the new cameras table
    // (migration 0047) rather than legacy camera_slots - resolved via
    // the same helper functions/api/public/cameras.ts uses, checked
    // first since a slot only ever has one or the other set.
    resolvedUrl:
      row.mediaType === "webcam"
        ? row.newCameraId
          ? resolveCameraUrl(row.newCameraMode ?? "local", row.newCameraYoutubeVideoId, row.newCameraLocalBaseUrl, row.newCameraId)
          : row.cameraUrl
        : row.r2Key && mediaBaseUrl
          ? `${mediaBaseUrl}/${row.r2Key}${row.mediaUploadedAt ? `?v=${encodeURIComponent(row.mediaUploadedAt)}` : ""}`
          : null,
  }));

  // Identical mapping to carouselSlots above, applied to café's own rows.
  const cafeCarouselSlots: CarouselSlotResolvedRow[] = cafeCarouselRows.results.map((row) => ({
    slotNumber: row.slotNumber,
    mediaType: row.mediaType,
    durationSeconds: row.durationSeconds,
    mp4DurationSeconds: row.mp4DurationSeconds,
    fitMode: row.fitMode,
    cropRect: { x: row.cropX, y: row.cropY, width: row.cropWidth, height: row.cropHeight },
    rotationDegrees: row.rotationDegrees,
    brightnessPercent: row.brightnessPercent,
    bannerText: row.bannerText,
    bannerOpacity: row.bannerOpacity,
    bannerFontSize: row.bannerFontSize,
    zone: row.zone,
    resolvedUrl:
      row.mediaType === "webcam"
        ? row.newCameraId
          ? resolveCameraUrl(row.newCameraMode ?? "local", row.newCameraYoutubeVideoId, row.newCameraLocalBaseUrl, row.newCameraId)
          : row.cameraUrl
        : row.r2Key && mediaBaseUrl
          ? `${mediaBaseUrl}/${row.r2Key}${row.mediaUploadedAt ? `?v=${encodeURIComponent(row.mediaUploadedAt)}` : ""}`
          : null,
  }));

  const opsPanel = opsPanelRow
    ? {
        // Parent/sub-tenant round: activeRunwayEnd/circuitDirection ONLY
        // come from the parent when linked (parentOpsPanelRow, queried
        // above) - falls back to this tenant's own value if the parent
        // has never touched /atc-control either (no ops_panel_state row
        // of its own yet), same "never a broken read" posture as
        // resolveParentTenant.ts's own dangling-parent fallback.
        // Everything else on this object is deliberately this TENANT's
        // OWN row, unaffected by any parent link - see this file's own
        // top comment for why (clubhouse notices/airfieldInfoText/
        // display settings are never inherited).
        activeRunwayEnd: parentOpsPanelRow?.activeRunwayEnd ?? opsPanelRow.activeRunwayEnd,
        circuitDirection: parentOpsPanelRow?.circuitDirection ?? opsPanelRow.circuitDirection,
        airfieldInfoText: opsPanelRow.airfieldInfoText,
        safetyNotices: JSON.parse(opsPanelRow.safetyNoticesJson) as SafetyNoticeResolved[],
        showAutoNotams: !!opsPanelRow.showAutoNotams,
        notamsCarouselIntervalSeconds: opsPanelRow.notamsCarouselIntervalSeconds,
        reverseCompassNeedle: !!opsPanelRow.reverseCompassNeedle,
        weatherSummaryChartEnabled: !!opsPanelRow.weatherSummaryChartEnabled,
        weatherSummaryStateADurationSeconds: opsPanelRow.weatherSummaryStateADurationSeconds,
        weatherSummaryStateBDurationSeconds: opsPanelRow.weatherSummaryStateBDurationSeconds,
        runwaysClosed: !!opsPanelRow.runwaysClosed,
      }
    : null;

  // Dedicated Gas Prices store (migration 0049) - missing row (never
  // saved) resolves to all-null prices, same posture as opsPanel's own
  // missing-row default above; the live dashboard's GasPricesPanel
  // renders nothing at all when every price is null rather than showing
  // empty/zero tiles.
  const gasPrices = {
    avgasPrice: effectiveGasPricesRow?.avgasPrice ?? null,
    ul91Price: effectiveGasPricesRow?.ul91Price ?? null,
    jetA1Price: effectiveGasPricesRow?.jetA1Price ?? null,
    currency: effectiveGasPricesRow?.currency ?? "£",
  };

  const mainTemplateId = mainDisplayRow?.templateId ?? "classic";
  // No row = never explicitly disabled -> active, same "missing row is
  // never a block" posture as mainTemplateId's own default above.
  const mainDisplayActive = mainDisplayRow ? !!mainDisplayRow.active : true;

  const cafeSettings = {
    layoutMode: cafeSettingsRow?.layoutMode ?? "full",
    adLabelEnabled: !!cafeSettingsRow?.adLabelEnabled,
    tickerEnabled: !!cafeSettingsRow?.tickerEnabled,
    tickerSlots: (cafeSettingsRow?.tickerSlotsJson
      ? JSON.parse(cafeSettingsRow.tickerSlotsJson)
      : Array.from({ length: 10 }, (_, i) => ({ position: i + 1, type: null, enabled: true }))
    ).map((slot: { position: number; type: string | null; enabled?: boolean; noticeId?: string; includeGasPrices?: boolean }) => ({
      position: slot.position,
      type: slot.type,
      // Missing on an older saved config = enabled, same
      // `enabled !== false` convention as safetyNotices.
      enabled: slot.enabled !== false,
      // noticeId was previously dropped here (this mapping only ever
      // returned position/type/enabled), which silently broke every
      // notice-type ticker slot on the LIVE public dashboard specifically
      // - CafeTemplate.tsx sources tickerSlots from exactly this field
      // (see its own PUBLIC_CONFIG_URL fetch), so a slot correctly saved
      // with a specific notice picked in CafeMediaPage.tsx would always
      // render blank once actually live. Fixed as part of adding
      // includeGasPrices below, the same class of "new optional field
      // silently stripped by an explicit field list" issue.
      noticeId: slot.noticeId,
      includeGasPrices: !!slot.includeGasPrices,
    })),
    tickerBackgroundColor: cafeSettingsRow?.tickerBackgroundColor ?? "#0f172a",
    tickerBackgroundOpacity: cafeSettingsRow?.tickerBackgroundOpacity ?? 100,
    tickerHeightPx: cafeSettingsRow?.tickerHeightPx ?? 64,
    tickerFontFamily: cafeSettingsRow?.tickerFontFamily ?? "Inter",
    tickerFontSizePx: cafeSettingsRow?.tickerFontSizePx ?? 16,
    tickerFontColor: cafeSettingsRow?.tickerFontColor ?? "#ffffff",
    tickerScrollSpeedPxPerSec: cafeSettingsRow?.tickerScrollSpeedPxPerSec ?? 80,
    tickerGapPx: cafeSettingsRow?.tickerGapPx ?? 0,
  };

  return {
    runwayGroups,
    theme,
    airfieldName,
    logoUrl,
    hasPhysicalAtc,
    brandDisplay,
    cameraSlots,
    cameras,
    carouselSlots,
    cafeCarouselSlots,
    opsPanel,
    gasPrices,
    mainTemplateId,
    mainDisplayActive,
    cafeSettings,
  };
}

// Thin wrapper - every existing caller (functions/api/public/config.ts,
// functions/api/public/[tenant]/config.ts) gets the exact same Response
// as before this split, unchanged.
export async function buildPublicConfigResponse(organizationId: string, env: PublicConfigEnv): Promise<Response> {
  return jsonResponse(await buildPublicConfigData(organizationId, env));
}
