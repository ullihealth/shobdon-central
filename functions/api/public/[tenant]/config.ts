// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard.
// GET /api/public/:tenant/config -> { runwayGroups, theme, cameraSlots, carouselSlots, opsPanel }
//
// carouselSlots is resolved server-side (media library R2 URL, or the
// referenced camera_slots URL for webcam) so the public dashboard never
// needs a second round-trip per slot to figure out what to render - only
// enabled slots are included, already sorted by slotNumber.
//
// Deliberately no session/login check anywhere in this file - PC2's kiosk
// browser (and anyone viewing the public dashboard) is not, and must
// never be required to be, logged in. This is the direct replacement for
// today's localStorage/global-KV reads (clubProfileStore.ts,
// THEME_URL) - same "no auth" posture as those, just centrally stored so
// every device sees the same values instead of whichever browser last
// wrote to its own localStorage.
//
// Authenticated writes for the management pages live in
// functions/api/tenant/[tenant]/*.ts, not here.

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results: T[] }>;
    };
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
};

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
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
}

interface OpsPanelRow {
  activeRunwayEnd: string;
  circuitDirection: string;
  airfieldInfoText: string;
  safetyNoticesJson: string;
  showAutoNotams: number;
  notamsCarouselIntervalSeconds: number;
  reverseCompassNeedle: number;
}

interface SafetyNoticeResolved {
  text: string;
  size: "sm" | "md" | "lg";
  enabled: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const slug = params.tenant;
  if (!slug) return jsonResponse({ error: "Missing tenant" }, 400);

  const org = await env.DB.prepare("SELECT id FROM organization WHERE slug = ?").bind(slug).first<{ id: string }>();
  if (!org) return jsonResponse({ error: "Unknown tenant" }, 404);

  const [runwayRows, themeRow, cameraRows, carouselRows, opsPanelRow] = await Promise.all([
    env.DB
      .prepare("SELECT id, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
      .bind(org.id)
      .all<RunwayGroupRow>(),
    env.DB.prepare("SELECT tokensJson FROM club_theme WHERE organizationId = ?").bind(org.id).first<{ tokensJson: string }>(),
    env.DB
      .prepare("SELECT slotNumber, label, url FROM camera_slots WHERE organizationId = ? ORDER BY slotNumber")
      .bind(org.id)
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
      .bind(org.id)
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
        mp4DurationSeconds: number | null;
        r2Key: string | null;
        mediaUploadedAt: string | null;
        cameraUrl: string | null;
      }>(),
    env.DB
      .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, reverseCompassNeedle FROM ops_panel_state WHERE organizationId = ?")
      .bind(org.id)
      .first<OpsPanelRow>(),
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

  const opsPanel = opsPanelRow
    ? {
        activeRunwayEnd: opsPanelRow.activeRunwayEnd,
        circuitDirection: opsPanelRow.circuitDirection,
        airfieldInfoText: opsPanelRow.airfieldInfoText,
        safetyNotices: JSON.parse(opsPanelRow.safetyNoticesJson) as SafetyNoticeResolved[],
        showAutoNotams: !!opsPanelRow.showAutoNotams,
        notamsCarouselIntervalSeconds: opsPanelRow.notamsCarouselIntervalSeconds,
        reverseCompassNeedle: !!opsPanelRow.reverseCompassNeedle,
      }
    : null;

  return jsonResponse({ runwayGroups, theme, cameraSlots, carouselSlots, opsPanel });
};
