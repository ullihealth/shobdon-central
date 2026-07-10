// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard.
// GET /api/public/:tenant/config -> { runwayGroups, theme, cameraSlots, carouselSlots }
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
  label: string;
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

  const [runwayRows, themeRow, cameraRows, carouselRows] = await Promise.all([
    env.DB
      .prepare("SELECT id, label, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder FROM runway_groups WHERE organizationId = ? ORDER BY sortOrder")
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
           ml.mp4DurationSeconds AS mp4DurationSeconds,
           ml.r2Key AS r2Key,
           cam.url AS cameraUrl
         FROM carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         LEFT JOIN camera_slots cam ON cam.organizationId = cs.organizationId AND cam.slotNumber = cs.cameraSlotNumber
         WHERE cs.organizationId = ? AND cs.enabled = 1
         ORDER BY cs.slotNumber`
      )
      .bind(org.id)
      .all<{ slotNumber: number; mediaType: string; durationSeconds: number; mp4DurationSeconds: number | null; r2Key: string | null; cameraUrl: string | null }>(),
  ]);

  const runwayGroups = runwayRows.results.map((row) => ({
    id: row.id,
    label: row.label,
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
    resolvedUrl:
      row.mediaType === "webcam" ? row.cameraUrl : row.r2Key && mediaBaseUrl ? `${mediaBaseUrl}/${row.r2Key}` : null,
  }));

  return jsonResponse({ runwayGroups, theme, cameraSlots, carouselSlots });
};
