// Owner/atc-role: GET/PUT /api/tenant/ops-panel - the ATC-control page's
// dynamic Ops Panel state (active runway end, circuit direction,
// airfield info text, up to 4 manual safety notice rows, and whether the
// automated NOTAM feed is shown at all). Deliberately
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
}

interface OpsPanelInput {
  activeRunwayEnd: string;
  circuitDirection: "left" | "right";
  airfieldInfoText: string;
  safetyNotices: string[];
  showAutoNotams: boolean;
}

const AIRFIELD_INFO_MAX_LENGTH = 60;
const SAFETY_NOTICE_MAX_LENGTH = 40;
const SAFETY_NOTICE_MAX_ROWS = 4;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<OpsPanelRow>();

  if (!row) {
    return jsonResponse({ activeRunwayEnd: "", circuitDirection: "left", airfieldInfoText: "", safetyNotices: [], showAutoNotams: true });
  }

  return jsonResponse({
    activeRunwayEnd: row.activeRunwayEnd,
    circuitDirection: row.circuitDirection,
    airfieldInfoText: row.airfieldInfoText,
    safetyNotices: JSON.parse(row.safetyNoticesJson),
    showAutoNotams: !!row.showAutoNotams,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "atc"]);
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
    if (typeof notice !== "string" || notice.length > SAFETY_NOTICE_MAX_LENGTH) {
      return jsonResponse({ error: `each safety notice must be a string of at most ${SAFETY_NOTICE_MAX_LENGTH} characters` }, 400);
    }
  }
  if (typeof body.showAutoNotams !== "boolean") {
    return jsonResponse({ error: "showAutoNotams must be a boolean" }, 400);
  }

  // Empty rows are dropped rather than stored as blanks - keeps the
  // public config's safetyNotices array free of placeholder empties that
  // would otherwise render as blank lines under the auto NOTAM text.
  const safetyNotices = body.safetyNotices.map((n) => n.trim()).filter((n) => n.length > 0);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         activeRunwayEnd = excluded.activeRunwayEnd,
         circuitDirection = excluded.circuitDirection,
         airfieldInfoText = excluded.airfieldInfoText,
         safetyNoticesJson = excluded.safetyNoticesJson,
         showAutoNotams = excluded.showAutoNotams,
         updatedAt = excluded.updatedAt`
    )
    .bind(organizationId, body.activeRunwayEnd, body.circuitDirection, body.airfieldInfoText, JSON.stringify(safetyNotices), body.showAutoNotams ? 1 : 0, now)
    .run();

  return jsonResponse({ ok: true });
};
