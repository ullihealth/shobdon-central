// Shared response-building logic for the public, UNAUTHENTICATED
// dashboard config read - GET .../config -> { runwayGroups, theme,
// cameraSlots, carouselSlots, opsPanel }. Extracted from
// functions/api/public/[tenant]/config.ts (the original slug-based
// route) so functions/api/public/config.ts (the new host-based route,
// Stage 3) can share the exact same query/response shape instead of a
// second copy to keep in sync. Both routes just resolve organizationId
// differently (URL path segment vs. Host header) and hand it to this.

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

export async function buildPublicConfigResponse(organizationId: string, env: PublicConfigEnv): Promise<Response> {
  const [runwayRows, themeRow, tenantRow, cameraRows, carouselRows, cafeCarouselRows, opsPanelRow, mainDisplayRow, cafeSettingsRow] = await Promise.all([
    env.DB
      .prepare("SELECT id, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
      .bind(organizationId)
      .all<RunwayGroupRow>(),
    env.DB.prepare("SELECT tokensJson FROM club_theme WHERE organizationId = ?").bind(organizationId).first<{ tokensJson: string }>(),
    // Real tenant display name (tenants.name) - was previously not part
    // of this response at all; Header.tsx hardcoded "SHOBDON AIRFIELD"
    // literally, since there was no per-tenant name flowing to the
    // public dashboard anywhere. Found during the pre-onboarding
    // branding audit. logo_r2_key resolved to logoUrl below, same
    // pattern as carouselSlots[].resolvedUrl.
    env.DB
      .prepare("SELECT name, logo_r2_key AS logoR2Key, has_physical_atc AS hasPhysicalAtc FROM tenants WHERE organization_id = ?")
      .bind(organizationId)
      .first<{ name: string; logoR2Key: string | null; hasPhysicalAtc: number }>(),
    env.DB
      .prepare("SELECT slotNumber, label, url FROM camera_slots WHERE organizationId = ? ORDER BY slotNumber")
      .bind(organizationId)
      .all<CameraSlotRow>(),
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
           cam.url AS cameraUrl
         FROM carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         LEFT JOIN camera_slots cam ON cam.organizationId = cs.organizationId AND cam.slotNumber = cs.cameraSlotNumber
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
           cam.url AS cameraUrl
         FROM cafe_carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         LEFT JOIN camera_slots cam ON cam.organizationId = cs.organizationId AND cam.slotNumber = cs.cameraSlotNumber
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
      }>(),
    env.DB
      .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, reverseCompassNeedle, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds FROM ops_panel_state WHERE organizationId = ?")
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
  ]);

  const runwayGroups = runwayRows.results.map((row) => ({
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

  const cameraSlots = cameraRows.results.map((row) => ({
    slot: row.slotNumber,
    label: row.label,
    url: row.url,
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
    resolvedUrl:
      row.mediaType === "webcam"
        ? row.cameraUrl
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
        ? row.cameraUrl
        : row.r2Key && mediaBaseUrl
          ? `${mediaBaseUrl}/${row.r2Key}${row.mediaUploadedAt ? `?v=${encodeURIComponent(row.mediaUploadedAt)}` : ""}`
          : null,
  }));

  const opsPanel = opsPanelRow
    ? {
        activeRunwayEnd: opsPanelRow.activeRunwayEnd,
        circuitDirection: opsPanelRow.circuitDirection,
        airfieldInfoText: opsPanelRow.airfieldInfoText,
        safetyNotices: JSON.parse(opsPanelRow.safetyNoticesJson) as SafetyNoticeResolved[],
        showAutoNotams: !!opsPanelRow.showAutoNotams,
        notamsCarouselIntervalSeconds: opsPanelRow.notamsCarouselIntervalSeconds,
        reverseCompassNeedle: !!opsPanelRow.reverseCompassNeedle,
        weatherSummaryChartEnabled: !!opsPanelRow.weatherSummaryChartEnabled,
        weatherSummaryStateADurationSeconds: opsPanelRow.weatherSummaryStateADurationSeconds,
        weatherSummaryStateBDurationSeconds: opsPanelRow.weatherSummaryStateBDurationSeconds,
      }
    : null;

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
    ).map((slot: { position: number; type: string | null; enabled?: boolean }) => ({
      position: slot.position,
      type: slot.type,
      // Missing on an older saved config = enabled, same
      // `enabled !== false` convention as safetyNotices.
      enabled: slot.enabled !== false,
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

  return jsonResponse({
    runwayGroups,
    theme,
    airfieldName,
    logoUrl,
    hasPhysicalAtc,
    cameraSlots,
    carouselSlots,
    cafeCarouselSlots,
    opsPanel,
    mainTemplateId,
    mainDisplayActive,
    cafeSettings,
  });
}
