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
  autoFullscreen: boolean;
}

interface OpsPanelRow {
  activeRunwayEnd: string;
  circuitDirection: string;
  airfieldInfoText: string;
  safetyNoticesJson: string;
  showAutoNotams: number;
  notamsCarouselIntervalSeconds: number;
  // Independent per-state durations (migration 0077), replacing the
  // single shared value above for RightInfoPanel.tsx's rotation -
  // notamsCarouselIntervalSeconds itself stays as-is/unused for now,
  // see that component's own comment.
  notamsOpsDurationSeconds: number;
  notamsFullDurationSeconds: number;
  noticesDurationSeconds: number;
  reverseCompassNeedle: number;
  weatherSummaryChartEnabled: number;
  weatherSummaryStateADurationSeconds: number;
  weatherSummaryStateBDurationSeconds: number;
  runwaysClosed: number;
  // /pilot header clock round (migration 0075) - tenant-local display
  // preference, deliberately NOT inherited via parent_tenant_id the way
  // reverseCompassNeedle a few lines above is (see this file's own
  // "ops_panel_state is deliberately NOT switched wholesale onto the
  // effective tenant" comment further up - same posture as
  // safetyNotices/airfieldInfoText).
  pilotClockMode: string;
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

  const [runwayRows, themeRow, tenantRow, effectiveOffsetRow, cameraRows, newCameraRows, carouselRows, cafeCarouselRows, opsPanelRow, mainDisplayRow, cafeSettingsRow, gasPricesRow, parentOpsPanelRow, ownRunwayRows, ownGasPricesRow, reservedSlotRows] = await Promise.all([
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
        // slug/parentSlug added for internetProviderDisplayName below -
        // internet_provider_display_name (migration 0083) is no longer
        // read here; that column is now inert (left in place, not
        // dropped, same "don't bother with an ALTER TABLE DROP COLUMN
        // for an inert column" convention as arrow_tailwind_kt's own
        // history) - the label is now DERIVED from the existing
        // parent_tenant_id relationship instead of a stored override,
        // so a future tenant linked to Shobdon automatically gets the
        // right label with no data change needed, the same way
        // parent-tenant.ts's own "Currently using X's weather station"
        // banner already works.
        "SELECT name, logo_r2_key AS logoR2Key, has_physical_atc AS hasPhysicalAtc, brand_display_json AS brandDisplayJson, carousel_budget_enabled AS carouselBudgetEnabled, afiso_open AS afisoOpen, afiso_frequency AS afisoFrequency, pilot_ticker_slots_json AS pilotTickerSlotsJson, pilot_background_override_json AS pilotBackgroundOverrideJson, pilot_ticker_style_json AS pilotTickerStyleJson, mobile_enabled AS mobileEnabled, windsock_band2_kt AS windsockBand2Kt, windsock_band3_kt AS windsockBand3Kt, windsock_band4_kt AS windsockBand4Kt, windsock_band5_kt AS windsockBand5Kt, arrow_tailwind_kt AS arrowTailwindKt, arrow_crosswind_kt AS arrowCrosswindKt, arrow_headwind_kt AS arrowHeadwindKt, qnh_qfe_offset_hpa AS qnhQfeOffsetHpa, active_weather_provider AS activeWeatherProvider, display_width_cm AS displayWidthCm, tenants.slug AS slug, (SELECT p.slug FROM tenants p WHERE p.id = tenants.parent_tenant_id) AS parentSlug, qr_slide_enabled AS qrSlideEnabled, qr_target_url AS qrTargetUrl, qr_caption_text AS qrCaptionText, qr_mockup_r2_key AS qrMockupR2Key FROM tenants WHERE organization_id = ?"
      )
      .bind(organizationId)
      .first<{
        name: string;
        logoR2Key: string | null;
        hasPhysicalAtc: number;
        brandDisplayJson: string | null;
        carouselBudgetEnabled: number;
        afisoOpen: number;
        afisoFrequency: string;
        pilotTickerSlotsJson: string;
        pilotBackgroundOverrideJson: string | null;
        pilotTickerStyleJson: string | null;
        mobileEnabled: number;
        windsockBand2Kt: number;
        windsockBand3Kt: number;
        windsockBand4Kt: number;
        windsockBand5Kt: number;
        arrowTailwindKt: number;
        arrowCrosswindKt: number;
        arrowHeadwindKt: number;
        qnhQfeOffsetHpa: number | null;
        activeWeatherProvider: string | null;
        displayWidthCm: number | null;
        slug: string;
        parentSlug: string | null;
        // QR/phone-mockup slide per-tenant config, Step 1 (migration
        // 0089) - selected here so it's reachable on the public config
        // response (see the qrSlide object built below), but
        // RightInfoPanel.tsx does not read it yet this step - it still
        // gates on the hardcoded tenantSlug === 'shobdon' stopgap
        // (commit acef934).
        qrSlideEnabled: number;
        qrTargetUrl: string;
        qrCaptionText: string;
        qrMockupR2Key: string | null;
      }>(),
    // Consistent QNH/QFE rounding round - this is a physical fact about
    // Shobdon's own station (its QFE datum vs QNH sea-level datum), not a
    // per-tenant preference, so it's read from the EFFECTIVE tenant here
    // (same reasoning as runway_groups/gas_prices' own effective-tenant
    // read above) rather than only ever the requesting tenant's own row -
    // a tenant linked to Shobdon inherits Shobdon's 11 automatically,
    // with no separate value needing to be set on its own row. Falls
    // back to the requesting tenant's own qnhQfeOffsetHpa (from tenantRow
    // above) when this comes back null - see the fallback computed below
    // this Promise.all, same "prefer parent, fall back to own" posture
    // as effectiveGasPricesRow.
    env.DB
      .prepare("SELECT qnh_qfe_offset_hpa AS qnhQfeOffsetHpa FROM tenants WHERE organization_id = ?")
      .bind(effective.organizationId)
      .first<{ qnhQfeOffsetHpa: number | null }>(),
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
           cs.autoFullscreen AS autoFullscreen,
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
        autoFullscreen: number;
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
           cs.autoFullscreen AS autoFullscreen,
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
        autoFullscreen: number;
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
      .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, notamsOpsDurationSeconds, notamsFullDurationSeconds, noticesDurationSeconds, reverseCompassNeedle, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds, runwaysClosed, pilot_clock_mode AS pilotClockMode FROM ops_panel_state WHERE organizationId = ?")
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
    // Parent's own activeRunwayEnd/circuitDirection/reverseCompassNeedle
    // ONLY - deliberately not the parent's full ops_panel_state row,
    // which would also pull in the parent's safetyNotices/
    // airfieldInfoText/display settings. reverseCompassNeedle joined
    // this splice after activeRunwayEnd/circuitDirection (it was
    // originally left as sub-tenant-own, same as safetyNotices) - a
    // real case (Shobdon's runway ends physically re-swapped, safety-
    // net toggled on to compensate) showed a linked sub-tenant reading
    // the same physical station's compass must also read the same
    // correction, not just the same raw heading data. Skipped entirely
    // (no query at all) for the common unlinked case - Promise.resolve(null)
    // rather than a real SELECT nobody needs.
    effective.isInherited
      ? env.DB
          .prepare("SELECT activeRunwayEnd, circuitDirection, reverseCompassNeedle FROM ops_panel_state WHERE organizationId = ?")
          .bind(effective.organizationId)
          .first<{ activeRunwayEnd: string; circuitDirection: string; reverseCompassNeedle: number }>()
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
    // Reserved Owner Slots & Time Budget round - slots 5/8/12's raw rows,
    // UNCONDITIONAL of their own `enabled` flag (unlike carouselRows
    // above, which only returns enabled=1 rows) - a reserved slot must
    // always appear in the live rotation regardless of whatever enabled
    // value happens to be sitting in this tenant's own row (which might
    // be stale/irrelevant leftover state from before this tenant was
    // ever ON this feature). Always queried (this file's own established
    // "one extra cheap indexed SELECT is fine" posture, same as
    // ownRunwayRows/ownGasPricesRow above) - only actually USED below
    // when tenantRow.carouselBudgetEnabled is true, since carouselBudgetEnabled
    // itself is resolved in this SAME Promise.all and can't gate which
    // queries run inside it.
    env.DB
      .prepare(
        `SELECT cs.slotNumber AS slotNumber, cs.mediaType AS mediaType, cs.mediaLibraryId AS mediaLibraryId,
                cs.ownerSlotUnlocked AS ownerSlotUnlocked, cs.ownerContentAssigned AS ownerContentAssigned,
                cs.fitMode AS fitMode, cs.cropX AS cropX, cs.cropY AS cropY, cs.cropWidth AS cropWidth, cs.cropHeight AS cropHeight,
                cs.rotationDegrees AS rotationDegrees, cs.brightnessPercent AS brightnessPercent,
                cs.bannerText AS bannerText, cs.bannerOpacity AS bannerOpacity, cs.bannerFontSize AS bannerFontSize,
                ml.mp4DurationSeconds AS mp4DurationSeconds, ml.r2Key AS r2Key, ml.uploadedAt AS mediaUploadedAt
         FROM carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         WHERE cs.organizationId = ? AND cs.slotNumber IN (5, 8, 12)`
      )
      .bind(organizationId)
      .all<{
        slotNumber: number;
        mediaType: string;
        mediaLibraryId: string | null;
        ownerSlotUnlocked: number;
        ownerContentAssigned: number;
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
        mp4DurationSeconds: number | null;
        r2Key: string | null;
        mediaUploadedAt: string | null;
      }>(),
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
  // Shared weather-provider selection (migration 0082) - the server-side
  // source of truth src/services/weatherConfigStore.ts's resolveWeatherConfig()
  // now checks on every load/refresh, so a provider change made via
  // /config on one device reaches every other device instead of being
  // stuck in that one browser's localStorage. null when no admin choice
  // has ever been recorded here yet - callers fall back to their own
  // existing structural/local default in that case, unchanged.
  const activeWeatherProvider = tenantRow?.activeWeatherProvider ?? null;
  // Internet-weather (Open-Meteo) display name - "Open-Meteo" is never
  // shown to any tenant; the underlying provider/fetch code is unchanged,
  // this is a display-label-only decision. Derived from the same
  // parent_tenant_id relationship parent-tenant.ts already reads for its
  // "Currently using X's weather station" banner: Shobdon itself, or any
  // tenant whose parent resolves to Shobdon, is factually Met-Office-
  // sourced through Open-Meteo's own UK data and gets the "SAWS" suffix;
  // every other tenant gets the bare name. A future tenant linked to
  // Shobdon via that same existing (platform-admin-only) mechanism picks
  // this up automatically, no code or data change needed here.
  const isShobdonRelated = tenantRow?.slug === "shobdon" || tenantRow?.parentSlug === "shobdon";
  const internetProviderDisplayName = isShobdonRelated ? "Met-Office SAWS" : "Met-Office";
  // Prefer the effective (parent, if linked) tenant's own value; fall
  // back to this tenant's own row only when the effective one is null -
  // same "prefer parent, fall back to own" shape as
  // effectiveGasPricesRow below. In the common unlinked case,
  // effectiveOffsetRow and tenantRow point at the exact same row, so
  // this is a no-op fallback (both already agree).
  const qnhQfeOffsetHpa = effectiveOffsetRow?.qnhQfeOffsetHpa ?? tenantRow?.qnhQfeOffsetHpa ?? null;
  const brandDisplay = parseBrandDisplay(tenantRow?.brandDisplayJson);
  // Pilot View round (migration 0070) - manual AFISO status, no live
  // data source exists for this anywhere (see that migration's own
  // comment). pilotTicker.slots defaults to [] when unset/malformed
  // rather than throwing - PilotViewPage.tsx's own ticker treats an
  // empty array as "nothing configured yet", same graceful-degradation
  // posture every other optional public-config field already takes.
  const afiso = { open: !!tenantRow?.afisoOpen, frequency: tenantRow?.afisoFrequency ?? "" };
  let pilotTickerSlots: unknown[] = [];
  try {
    pilotTickerSlots = tenantRow?.pilotTickerSlotsJson ? JSON.parse(tenantRow.pilotTickerSlotsJson) : [];
  } catch {
    pilotTickerSlots = [];
  }
  const pilotTicker = { slots: pilotTickerSlots };
  // QR/phone-mockup slide per-tenant config, Step 1 (migration 0089) -
  // same {enabled, ...fields} shape as afiso above, mockupImageUrl
  // built from qr_mockup_r2_key the exact same way logoUrl is built
  // from logo_r2_key a few lines up. RightInfoPanel.tsx does not read
  // this object yet this step - it still gates the slide on the
  // hardcoded tenantSlug === 'shobdon' stopgap (commit acef934); this
  // only makes the data reachable so a later step can switch over to it.
  const qrSlide = {
    enabled: !!tenantRow?.qrSlideEnabled,
    targetUrl: tenantRow?.qrTargetUrl ?? "",
    captionText: tenantRow?.qrCaptionText ?? "",
    mockupImageUrl:
      tenantRow?.qrMockupR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${tenantRow.qrMockupR2Key}` : null,
  };
  // Pilot Panel round (migration 0085) - optional per-tenant override of
  // /pilot's background colour, independent of the shared club_theme
  // record the desktop dashboard uses. null (the column's default, and
  // every existing tenant's current value) means "keep inheriting
  // club_theme exactly as before" - PilotViewPage.tsx only departs from
  // that when this is genuinely non-null, so this migration is inert
  // for every tenant until they explicitly opt in via Pilot Panel.
  let pilotBackgroundOverride: { backgroundColor: string } | null = null;
  if (tenantRow?.pilotBackgroundOverrideJson) {
    try {
      const parsed = JSON.parse(tenantRow.pilotBackgroundOverrideJson) as { backgroundColor?: unknown };
      if (typeof parsed.backgroundColor === "string") pilotBackgroundOverride = { backgroundColor: parsed.backgroundColor };
    } catch {
      pilotBackgroundOverride = null;
    }
  }
  // Pilot Panel round (migration 0086) - optional per-tenant override of
  // /pilot's ticker style (background/font/height/speed/gap), independent
  // of PilotFooterTicker.tsx's own fixed DEFAULT_TICKER_STYLE constant.
  // null (the column's default) means "keep using that constant exactly
  // as before" - same inert-until-opted-in posture as
  // pilotBackgroundOverride above.
  interface PilotTickerStyle {
    backgroundColor: string;
    backgroundOpacity: number;
    heightPx: number;
    fontFamily: string;
    fontSizePx: number;
    fontColor: string;
    scrollSpeedPxPerSec: number;
    gapPx: number;
  }
  let pilotTickerStyle: PilotTickerStyle | null = null;
  if (tenantRow?.pilotTickerStyleJson) {
    try {
      const parsed = JSON.parse(tenantRow.pilotTickerStyleJson) as Partial<PilotTickerStyle>;
      if (
        typeof parsed.backgroundColor === "string" &&
        typeof parsed.backgroundOpacity === "number" &&
        typeof parsed.heightPx === "number" &&
        typeof parsed.fontFamily === "string" &&
        typeof parsed.fontSizePx === "number" &&
        typeof parsed.fontColor === "string" &&
        typeof parsed.scrollSpeedPxPerSec === "number" &&
        typeof parsed.gapPx === "number"
      ) {
        pilotTickerStyle = parsed as PilotTickerStyle;
      }
    } catch {
      pilotTickerStyle = null;
    }
  }
  // Mobile access gating round (migration 0071) - PilotViewPage.tsx
  // renders its locked-state screen instead of the full view when this
  // is false. Testing-phase only right now (see that migration's own
  // comment) - every existing tenant was backfilled to true, so this is
  // not yet an active restriction for anyone. mobile_free_until is a
  // placeholder-only column, deliberately not read/exposed here - no
  // gating logic depends on it yet.
  const mobileEnabled = !!tenantRow?.mobileEnabled;
  // Runway/Wind widget (RunwayWindWidget.tsx) - 5-tier windsock
  // (migration 0079). Falls back to the same real-world-convention
  // defaults that migration seeds (3/7/11/15kt) if this tenant's row
  // predates it somehow, same defensive posture every other tenantRow
  // field on this page already takes.
  const windsock = {
    band2Kt: tenantRow?.windsockBand2Kt ?? 3,
    band3Kt: tenantRow?.windsockBand3Kt ?? 7,
    band4Kt: tenantRow?.windsockBand4Kt ?? 11,
    band5Kt: tenantRow?.windsockBand5Kt ?? 15,
  };
  // Compass needle / runway wind widget arrow colour thresholds
  // (migration 0081) - developer-editable only via direct D1 update, no
  // self-service UI (unlike windsock above). Defaults here match
  // DEFAULT_ARROW_THRESHOLDS in src/utils/windCalculations.ts - kept as
  // plain literals rather than importing that constant, since nothing in
  // functions/ currently imports from src/ (a separate build) and this
  // file's other tenantRow defaults (windsock included) already use the
  // same inline-literal-fallback convention rather than a shared import.
  const arrowThresholds = {
    tailwindKt: tenantRow?.arrowTailwindKt ?? 2,
    crosswindKt: tenantRow?.arrowCrosswindKt ?? 5,
    headwindKt: tenantRow?.arrowHeadwindKt ?? 3,
  };
  // Physical screen width in cm (migration 0088) - null passed through
  // as-is, NOT defaulted here. Unlike windsock/arrowThresholds above,
  // null is a meaningful distinct state ("not yet confirmed for this
  // tenant"), and the fallback assumption plus its own dev-mode warning
  // belong client-side, in RightInfoPanel.tsx (the only consumer),
  // rather than being silently applied here where nothing would ever see
  // the warning.
  const displayWidthCm = tenantRow?.displayWidthCm ?? null;

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
    autoFullscreen: !!row.autoFullscreen,
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

  // Reserved Owner Slots & Time Budget round. carouselRows above only
  // ever returns enabled=1 rows (see that query's own WHERE clause), so
  // a reserved slot the owner hasn't touched yet (or a tenant's own
  // pre-existing row, now shadowed - see migration 0064's own comment on
  // why ownerContentAssigned exists) simply wouldn't appear at all - but
  // a reserved slot must ALWAYS be in the rotation, 10 seconds, whether
  // or not the owner has assigned real content yet. Only slotNumbers
  // still actually reserved for THIS tenant (carouselBudgetEnabled true
  // AND this specific slot's ownerSlotUnlocked false) get this
  // treatment; an unlocked reserved slot is deliberately left to flow
  // through from carouselRows above completely normally, as if it were
  // never reserved at all.
  const carouselBudgetEnabled = !!tenantRow?.carouselBudgetEnabled;
  if (carouselBudgetEnabled) {
    // Iterate the fixed [5, 8, 12] list, not reservedSlotRows.results -
    // a tenant who has never touched Dashboard Manager at all (or never
    // saved these specific slots) has NO carousel_slots row yet for
    // 5/8/12, so reservedSlotRows.results would simply omit them
    // entirely; a reserved slot must still always appear (10s, "Media
    // Reserved" placeholder) even then - same "row may not exist yet,
    // fall back to defaults" posture as tenant/carousel/index.ts's own
    // defaultSlots() fallback.
    const reservedRowsBySlot = new Map(reservedSlotRows.results.map((row) => [row.slotNumber, row]));
    for (const slotNumber of [5, 8, 12]) {
      const row = reservedRowsBySlot.get(slotNumber);
      if (row?.ownerSlotUnlocked) continue;
      const existingIndex = carouselSlots.findIndex((slot) => slot.slotNumber === slotNumber);
      if (existingIndex !== -1) carouselSlots.splice(existingIndex, 1);

      const reservedSlot: CarouselSlotResolvedRow = row?.ownerContentAssigned
        ? {
            slotNumber,
            mediaType: row.mediaType,
            durationSeconds: 10,
            mp4DurationSeconds: row.mp4DurationSeconds,
            fitMode: row.fitMode,
            cropRect: { x: row.cropX, y: row.cropY, width: row.cropWidth, height: row.cropHeight },
            rotationDegrees: row.rotationDegrees,
            brightnessPercent: row.brightnessPercent,
            bannerText: row.bannerText,
            bannerOpacity: row.bannerOpacity,
            bannerFontSize: row.bannerFontSize,
            zone: "both",
            autoFullscreen: false,
            resolvedUrl: row.r2Key && mediaBaseUrl ? `${mediaBaseUrl}/${row.r2Key}${row.mediaUploadedAt ? `?v=${encodeURIComponent(row.mediaUploadedAt)}` : ""}` : null,
          }
        : {
            // No owner content assigned yet (or no row exists for this
            // slot at all yet - a tenant who's never touched Dashboard
            // Manager) - "Media Reserved" placeholder (MediaSlotRenderer.
            // tsx's own 'reserved' case), same no-resolvedUrl-needed shape
            // as the existing 'gyropedia' sentinel type.
            slotNumber,
            mediaType: "reserved",
            durationSeconds: 10,
            mp4DurationSeconds: null,
            fitMode: "contain",
            cropRect: { x: 0, y: 0, width: 100, height: 100 },
            rotationDegrees: 0,
            brightnessPercent: 100,
            bannerText: "",
            bannerOpacity: 70,
            bannerFontSize: "md",
            zone: "both",
            autoFullscreen: false,
            resolvedUrl: null,
          };
      carouselSlots.push(reservedSlot);
    }
    carouselSlots.sort((a, b) => a.slotNumber - b.slotNumber);
  }

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
    autoFullscreen: !!row.autoFullscreen,
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
        // Parent/sub-tenant round: activeRunwayEnd/circuitDirection/
        // reverseCompassNeedle ONLY come from the parent when linked
        // (parentOpsPanelRow, queried above) - falls back to this
        // tenant's own value if the parent has never touched
        // /atc-control either (no ops_panel_state row of its own yet),
        // same "never a broken read" posture as resolveParentTenant.ts's
        // own dangling-parent fallback. Everything else on this object
        // is deliberately this TENANT's OWN row, unaffected by any
        // parent link - see this file's own top comment for why
        // (clubhouse notices/airfieldInfoText/display settings are
        // never inherited).
        activeRunwayEnd: parentOpsPanelRow?.activeRunwayEnd ?? opsPanelRow.activeRunwayEnd,
        circuitDirection: parentOpsPanelRow?.circuitDirection ?? opsPanelRow.circuitDirection,
        airfieldInfoText: opsPanelRow.airfieldInfoText,
        safetyNotices: JSON.parse(opsPanelRow.safetyNoticesJson) as SafetyNoticeResolved[],
        showAutoNotams: !!opsPanelRow.showAutoNotams,
        notamsCarouselIntervalSeconds: opsPanelRow.notamsCarouselIntervalSeconds,
        notamsOpsDurationSeconds: opsPanelRow.notamsOpsDurationSeconds,
        notamsFullDurationSeconds: opsPanelRow.notamsFullDurationSeconds,
        noticesDurationSeconds: opsPanelRow.noticesDurationSeconds,
        reverseCompassNeedle: !!(parentOpsPanelRow?.reverseCompassNeedle ?? opsPanelRow.reverseCompassNeedle),
        weatherSummaryChartEnabled: !!opsPanelRow.weatherSummaryChartEnabled,
        weatherSummaryStateADurationSeconds: opsPanelRow.weatherSummaryStateADurationSeconds,
        weatherSummaryStateBDurationSeconds: opsPanelRow.weatherSummaryStateBDurationSeconds,
        runwaysClosed: !!opsPanelRow.runwaysClosed,
        // Tenant-local, never inherited - see OpsPanelRow's own comment.
        pilotClockMode: opsPanelRow.pilotClockMode || "summer",
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
    ).map(
      (slot: {
        position: number;
        type: string | null;
        enabled?: boolean;
        noticeId?: string;
        textMode?: boolean;
        manualText?: string;
        textColor?: string;
      }) => ({
        position: slot.position,
        type: slot.type,
        // Missing on an older saved config = enabled, same
        // `enabled !== false` convention as safetyNotices.
        enabled: slot.enabled !== false,
        // noticeId was previously dropped here (this mapping only ever
        // returned position/type/enabled), which silently broke every
        // notice-type ticker slot on the LIVE public dashboard
        // specifically - CafeTemplate.tsx/FooterTicker.tsx source
        // tickerSlots from exactly this field (see their own
        // PUBLIC_CONFIG_URL fetch), so a slot correctly saved with a
        // specific notice picked in the admin editor would always
        // render blank once actually live. textMode/manualText
        // (Text/Fuel rework) added proactively here for the same
        // reason, rather than waiting to rediscover this same bug a
        // third time. textColor added the same way, proactively, for
        // the identical reason - this explicit field list is exactly
        // the kind of allowlist a new TickerSlot field silently falls
        // through unless it's added here too.
        noticeId: slot.noticeId,
        textMode: !!slot.textMode,
        manualText: slot.manualText,
        textColor: slot.textColor,
      })
    ),
    // heightPx/fontSizePx defaults: 40/22 (was 64/16) - matches
    // tickerStyleStore.ts's own DEFAULT_TICKER_STYLE and cafe-settings/
    // index.ts's defaultSettings() (see either's comment for why this
    // changed and why it's new-tenant-only). Only reached for a tenant
    // with no cafe_template_settings row at all - tickerEnabled defaults
    // false in that same case (below), so nothing actually renders these
    // values live until a real save happens anyway; kept in sync purely
    // so this endpoint can never disagree with what the editor itself
    // shows as "the default" for a brand-new tenant.
    tickerBackgroundColor: cafeSettingsRow?.tickerBackgroundColor ?? "#0f172a",
    tickerBackgroundOpacity: cafeSettingsRow?.tickerBackgroundOpacity ?? 100,
    tickerHeightPx: cafeSettingsRow?.tickerHeightPx ?? 40,
    tickerFontFamily: cafeSettingsRow?.tickerFontFamily ?? "Inter",
    tickerFontSizePx: cafeSettingsRow?.tickerFontSizePx ?? 22,
    tickerFontColor: cafeSettingsRow?.tickerFontColor ?? "#ffffff",
    tickerScrollSpeedPxPerSec: cafeSettingsRow?.tickerScrollSpeedPxPerSec ?? 80,
    tickerGapPx: cafeSettingsRow?.tickerGapPx ?? 0,
  };

  return {
    // Stopgap for the QR/phone-mockup rotation slide's tenant gate
    // (RightInfoPanel.tsx) - that slide's content (URL, phone image,
    // "Shobdon Pilot App" caption) is currently Shobdon-specific and
    // hardcoded, not yet tenant-configurable, so it must not render for
    // any other tenant. tenantRow.slug was already selected above for
    // isShobdonRelated's own internetProviderDisplayName check - just
    // exposing that same already-fetched column here, not a new query
    // or schema change.
    slug: tenantRow?.slug ?? null,
    runwayGroups,
    theme,
    airfieldName,
    logoUrl,
    hasPhysicalAtc,
    activeWeatherProvider,
    internetProviderDisplayName,
    qnhQfeOffsetHpa,
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
    afiso,
    pilotTicker,
    qrSlide,
    pilotBackgroundOverride,
    pilotTickerStyle,
    mobileEnabled,
    windsock,
    arrowThresholds,
    displayWidthCm,
  };
}

// Thin wrapper - every existing caller (functions/api/public/config.ts,
// functions/api/public/[tenant]/config.ts) gets the exact same Response
// as before this split, unchanged.
export async function buildPublicConfigResponse(organizationId: string, env: PublicConfigEnv): Promise<Response> {
  return jsonResponse(await buildPublicConfigData(organizationId, env));
}
