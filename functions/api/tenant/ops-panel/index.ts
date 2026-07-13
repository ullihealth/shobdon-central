// Owner/admin/atc-role: GET/PUT /api/tenant/ops-panel - the ATC-control page's
// dynamic Ops Panel state (active runway end, circuit direction,
// airfield info text, up to 10 manual safety notice rows each with its
// own size and enabled/disabled flag, whether the automated NOTAM feed
// is shown at all, and how often the live
// dashboard rotates between its normal and NOTAMS states). Deliberately
// separate from tenant/config.ts (which stays requireOwner-only) so atc
// members get exactly this one write surface, not the rest of /config's
// owner-only areas.
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
}

interface SafetyNoticeInput {
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
}

const AIRFIELD_INFO_MAX_LENGTH = 60;
const SAFETY_NOTICE_MAX_LENGTH = 40;
const SAFETY_NOTICE_MAX_ROWS = 10;
const NOTICE_SIZES = ["sm", "md", "lg", "xl"];
const NOTAMS_INTERVAL_MIN_SECONDS = 2;
const NOTAMS_INTERVAL_MAX_SECONDS = 30;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds FROM ops_panel_state WHERE organizationId = ?")
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
    });
  }

  return jsonResponse({
    activeRunwayEnd: row.activeRunwayEnd,
    circuitDirection: row.circuitDirection,
    airfieldInfoText: row.airfieldInfoText,
    safetyNotices: JSON.parse(row.safetyNoticesJson),
    showAutoNotams: !!row.showAutoNotams,
    notamsCarouselIntervalSeconds: row.notamsCarouselIntervalSeconds,
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
      typeof notice.enabled !== "boolean"
    ) {
      return jsonResponse(
        {
          error: `each safety notice must be {text: string (max ${SAFETY_NOTICE_MAX_LENGTH} chars), size: 'sm'|'md'|'lg'|'xl', enabled: boolean}`,
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

  // Empty rows are dropped rather than stored as blanks - keeps the
  // public config's safetyNotices array free of placeholder empties that
  // would otherwise render as blank lines under the auto NOTAM text.
  const safetyNotices = body.safetyNotices
    .map((n) => ({ text: n.text.trim(), size: n.size, enabled: n.enabled }))
    .filter((n) => n.text.length > 0);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         activeRunwayEnd = excluded.activeRunwayEnd,
         circuitDirection = excluded.circuitDirection,
         airfieldInfoText = excluded.airfieldInfoText,
         safetyNoticesJson = excluded.safetyNoticesJson,
         showAutoNotams = excluded.showAutoNotams,
         notamsCarouselIntervalSeconds = excluded.notamsCarouselIntervalSeconds,
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
      now
    )
    .run();

  return jsonResponse({ ok: true });
};
