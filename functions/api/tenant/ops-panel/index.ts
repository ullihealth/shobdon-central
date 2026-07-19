// Owner/admin/atc-role: GET/PUT /api/tenant/ops-panel - the ATC-control page's
// dynamic Ops Panel state (active runway end, circuit direction,
// airfield info text, up to 10 manual safety notice rows each with its
// own NAME, size, and enabled/disabled flag, whether the automated NOTAM
// feed is shown at all, and how often the live dashboard rotates between
// its normal and NOTAMS states). Deliberately separate from
// tenant/config.ts (which stays requireOwner-only) so atc members get
// exactly this one write surface, not the rest of /config's owner-only
// areas.
//
// Also the single source of truth CafeMediaPage.tsx's notice CRUD reads/
// writes - same endpoint, same table, same JSON column ATC Control
// already used. Notices gained `id` (stable, needed so a café ticker
// slot can reference one SPECIFIC notice) and `name` (a tenant-given
// label, needed now that there can be several distinct notices, not one
// undifferentiated block of text) - both self-healed onto any
// pre-existing notice that predates this field (see ensureNoticeShape
// below), so nothing already saved is lost or requires a manual data
// migration.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface OpsPanelRow {
  activeRunwayEnd: string;
  circuitDirection: string;
  airfieldInfoText: string;
  safetyNoticesJson: string;
  showAutoNotams: number;
  notamsCarouselIntervalSeconds: number;
  weatherSummaryChartEnabled: number;
  weatherSummaryStateADurationSeconds: number;
  weatherSummaryStateBDurationSeconds: number;
}

interface SafetyNoticeInput {
  // Optional on input - a brand-new notice from either editor may not
  // have generated one yet; ensureNoticeShape() below fills it in
  // server-side either way, so this is never actually missing by the
  // time it's persisted.
  id?: string;
  name?: string;
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  enabled: boolean;
}

interface SafetyNoticeStored {
  id: string;
  name: string;
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  enabled: boolean;
}

interface OpsPanelInput {
  activeRunwayEnd: string;
  circuitDirection: "left" | "right";
  airfieldInfoText: string;
  safetyNotices: SafetyNoticeInput[];
  showAutoNotams: boolean;
  notamsCarouselIntervalSeconds: number;
  weatherSummaryChartEnabled: boolean;
  weatherSummaryStateADurationSeconds: number;
  weatherSummaryStateBDurationSeconds: number;
}

const AIRFIELD_INFO_MAX_LENGTH = 60;
const SAFETY_NOTICE_MAX_LENGTH = 40;
const SAFETY_NOTICE_NAME_MAX_LENGTH = 40;
const SAFETY_NOTICE_MAX_ROWS = 10;
const NOTICE_SIZES = ["sm", "md", "lg", "xl"];
const NOTAMS_INTERVAL_MIN_SECONDS = 2;
const NOTAMS_INTERVAL_MAX_SECONDS = 30;
// Same bounds as the NOTAMS interval above, per the approved plan - no
// reason for Weather Summary's own rotation to allow a wider range.
const WEATHER_SUMMARY_DURATION_MIN_SECONDS = 2;
const WEATHER_SUMMARY_DURATION_MAX_SECONDS = 30;

// Backfills `id`/`name` onto any notice that predates those fields
// (every notice saved before this change) - crypto.randomUUID() is
// available in the Workers runtime same as any modern browser. `name`
// defaults to a truncated copy of the text rather than a generic
// "Untitled" placeholder, since the text is usually already a
// reasonable label at a glance (e.g. "Fish & Chips Offer" as both name
// AND text is a completely normal, valid notice - this only kicks in
// when `name` is genuinely absent, not to second-guess one that's
// already been explicitly set, including to something short).
function ensureNoticeShape(notice: SafetyNoticeInput): SafetyNoticeStored {
  return {
    id: notice.id && notice.id.trim() ? notice.id : crypto.randomUUID(),
    name: notice.name && notice.name.trim() ? notice.name.trim().slice(0, SAFETY_NOTICE_NAME_MAX_LENGTH) : notice.text.slice(0, SAFETY_NOTICE_NAME_MAX_LENGTH),
    text: notice.text,
    size: notice.size,
    enabled: notice.enabled,
  };
}

// True if ANY notice in the array was missing id/name before
// ensureNoticeShape ran - GET uses this to decide whether the healed
// array needs writing back at all, so a row that's already fully
// migrated never triggers a needless UPDATE on every read.
function neededHealing(raw: SafetyNoticeInput[]): boolean {
  return raw.some((notice) => !notice.id || !notice.name);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<OpsPanelRow>();

  if (!row) {
    return jsonResponse({
      activeRunwayEnd: "",
      circuitDirection: "left",
      airfieldInfoText: "",
      safetyNotices: [],
      showAutoNotams: true,
      notamsCarouselIntervalSeconds: 5,
      weatherSummaryChartEnabled: false,
      weatherSummaryStateADurationSeconds: 8,
      weatherSummaryStateBDurationSeconds: 5,
    });
  }

  // Self-healing id/name backfill - a GET that writes is unusual, but
  // this is a deliberate, idempotent, one-time correction (see
  // ensureNoticeShape's own comment), not an ordinary side effect: every
  // existing notice saved before id/name existed gets them assigned HERE
  // and PERSISTED immediately, so the same notice has the same stable id
  // on every subsequent read - both ATC Control and CAFE MEDIA call this
  // same GET, so whichever page is opened first triggers the heal and
  // the other sees the already-healed result.
  const rawNotices = JSON.parse(row.safetyNoticesJson) as SafetyNoticeInput[];
  const safetyNotices = rawNotices.map(ensureNoticeShape);
  if (neededHealing(rawNotices)) {
    await env.DB
      .prepare("UPDATE ops_panel_state SET safetyNoticesJson = ? WHERE organizationId = ?")
      .bind(JSON.stringify(safetyNotices), organizationId)
      .run();
  }

  return jsonResponse({
    activeRunwayEnd: row.activeRunwayEnd,
    circuitDirection: row.circuitDirection,
    airfieldInfoText: row.airfieldInfoText,
    safetyNotices,
    showAutoNotams: !!row.showAutoNotams,
    notamsCarouselIntervalSeconds: row.notamsCarouselIntervalSeconds,
    weatherSummaryChartEnabled: !!row.weatherSummaryChartEnabled,
    weatherSummaryStateADurationSeconds: row.weatherSummaryStateADurationSeconds,
    weatherSummaryStateBDurationSeconds: row.weatherSummaryStateBDurationSeconds,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as OpsPanelInput | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  if (typeof body.activeRunwayEnd !== "string" || !body.activeRunwayEnd.trim()) {
    return jsonResponse({ error: "activeRunwayEnd is required" }, 400);
  }
  if (body.circuitDirection !== "left" && body.circuitDirection !== "right") {
    return jsonResponse({ error: "circuitDirection must be 'left' or 'right'" }, 400);
  }
  if (typeof body.airfieldInfoText !== "string" || body.airfieldInfoText.length > AIRFIELD_INFO_MAX_LENGTH) {
    return jsonResponse({ error: `airfieldInfoText must be a string of at most ${AIRFIELD_INFO_MAX_LENGTH} characters` }, 400);
  }
  if (!Array.isArray(body.safetyNotices) || body.safetyNotices.length > SAFETY_NOTICE_MAX_ROWS) {
    return jsonResponse({ error: `safetyNotices must be an array of at most ${SAFETY_NOTICE_MAX_ROWS} rows` }, 400);
  }
  for (const notice of body.safetyNotices) {
    if (
      typeof notice !== "object" ||
      notice === null ||
      typeof notice.text !== "string" ||
      notice.text.length > SAFETY_NOTICE_MAX_LENGTH ||
      !NOTICE_SIZES.includes(notice.size) ||
      typeof notice.enabled !== "boolean" ||
      (notice.id !== undefined && typeof notice.id !== "string") ||
      (notice.name !== undefined && (typeof notice.name !== "string" || notice.name.length > SAFETY_NOTICE_NAME_MAX_LENGTH))
    ) {
      return jsonResponse(
        {
          error: `each safety notice must be {name?: string (max ${SAFETY_NOTICE_NAME_MAX_LENGTH} chars), text: string (max ${SAFETY_NOTICE_MAX_LENGTH} chars), size: 'sm'|'md'|'lg'|'xl', enabled: boolean}`,
        },
        400
      );
    }
  }
  if (typeof body.showAutoNotams !== "boolean") {
    return jsonResponse({ error: "showAutoNotams must be a boolean" }, 400);
  }
  if (
    !Number.isInteger(body.notamsCarouselIntervalSeconds) ||
    body.notamsCarouselIntervalSeconds < NOTAMS_INTERVAL_MIN_SECONDS ||
    body.notamsCarouselIntervalSeconds > NOTAMS_INTERVAL_MAX_SECONDS
  ) {
    return jsonResponse(
      { error: `notamsCarouselIntervalSeconds must be an integer between ${NOTAMS_INTERVAL_MIN_SECONDS} and ${NOTAMS_INTERVAL_MAX_SECONDS}` },
      400
    );
  }
  if (typeof body.weatherSummaryChartEnabled !== "boolean") {
    return jsonResponse({ error: "weatherSummaryChartEnabled must be a boolean" }, 400);
  }
  if (
    !Number.isInteger(body.weatherSummaryStateADurationSeconds) ||
    body.weatherSummaryStateADurationSeconds < WEATHER_SUMMARY_DURATION_MIN_SECONDS ||
    body.weatherSummaryStateADurationSeconds > WEATHER_SUMMARY_DURATION_MAX_SECONDS
  ) {
    return jsonResponse(
      {
        error: `weatherSummaryStateADurationSeconds must be an integer between ${WEATHER_SUMMARY_DURATION_MIN_SECONDS} and ${WEATHER_SUMMARY_DURATION_MAX_SECONDS}`,
      },
      400
    );
  }
  if (
    !Number.isInteger(body.weatherSummaryStateBDurationSeconds) ||
    body.weatherSummaryStateBDurationSeconds < WEATHER_SUMMARY_DURATION_MIN_SECONDS ||
    body.weatherSummaryStateBDurationSeconds > WEATHER_SUMMARY_DURATION_MAX_SECONDS
  ) {
    return jsonResponse(
      {
        error: `weatherSummaryStateBDurationSeconds must be an integer between ${WEATHER_SUMMARY_DURATION_MIN_SECONDS} and ${WEATHER_SUMMARY_DURATION_MAX_SECONDS}`,
      },
      400
    );
  }

  // Empty rows are dropped rather than stored as blanks - keeps the
  // public config's safetyNotices array free of placeholder empties that
  // would otherwise render as blank lines under the auto NOTAM text.
  // ensureNoticeShape both normalizes (trims name/keeps text as-is) and
  // guarantees every surviving notice has a stable id - a brand-new
  // notice from either editor gets one minted here if the client didn't
  // already send one.
  const safetyNotices = body.safetyNotices
    .map((n) => ensureNoticeShape({ ...n, text: n.text.trim() }))
    .filter((n) => n.text.length > 0);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         activeRunwayEnd = excluded.activeRunwayEnd,
         circuitDirection = excluded.circuitDirection,
         airfieldInfoText = excluded.airfieldInfoText,
         safetyNoticesJson = excluded.safetyNoticesJson,
         showAutoNotams = excluded.showAutoNotams,
         notamsCarouselIntervalSeconds = excluded.notamsCarouselIntervalSeconds,
         weatherSummaryChartEnabled = excluded.weatherSummaryChartEnabled,
         weatherSummaryStateADurationSeconds = excluded.weatherSummaryStateADurationSeconds,
         weatherSummaryStateBDurationSeconds = excluded.weatherSummaryStateBDurationSeconds,
         updatedAt = excluded.updatedAt`
    )
    .bind(
      organizationId,
      body.activeRunwayEnd,
      body.circuitDirection,
      body.airfieldInfoText,
      JSON.stringify(safetyNotices),
      body.showAutoNotams ? 1 : 0,
      body.notamsCarouselIntervalSeconds,
      body.weatherSummaryChartEnabled ? 1 : 0,
      body.weatherSummaryStateADurationSeconds,
      body.weatherSummaryStateBDurationSeconds,
      now
    )
    .run();

  return jsonResponse({ ok: true });
};
