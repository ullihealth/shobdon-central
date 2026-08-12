// Owner/admin/atc: GET/POST /api/tenant/pilot-ticker-style-templates
//
// Server-persisted custom Pilot ticker style templates - direct
// structural copy of functions/api/tenant/design-templates/index.ts
// (same table shape: id/organizationId/name/<blob>Json/createdAt, same
// GET-list/POST-create split, same "named saved LIST of alternates, not
// the one currently-applied value" distinction from
// pilot_ticker_style_json). requireRoles(['owner','admin','atc']) here
// instead of design-templates' requireOwner - matches Pilot Panel's own
// access list (this page must work for atc), not Screens Design's
// owner/admin-only gate.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TickerStyleInput {
  backgroundColor: string;
  backgroundOpacity: number;
  heightPx: number;
  fontFamily: string;
  fontSizePx: number;
  fontColor: string;
  scrollSpeedPxPerSec: number;
  gapPx: number;
}

interface TemplateRow {
  id: string;
  name: string;
  styleJson: string;
  createdAt: string;
}

interface TemplateResponse {
  id: string;
  name: string;
  style: TickerStyleInput;
  createdAt: string;
}

function toResponseShape(row: TemplateRow): TemplateResponse {
  return {
    id: row.id,
    name: row.name,
    style: JSON.parse(row.styleJson) as TickerStyleInput,
    createdAt: row.createdAt,
  };
}

const MAX_NAME_LENGTH = 60;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const VALID_FONT_FAMILIES = ["Inter", "Montserrat", "Oswald"];

// Same ranges as pilot-view.ts's own tickerStyle validation (which
// itself mirrors cafe-settings/index.ts, except scrollSpeedPxPerSec
// capped at 200 not 500) - duplicated here rather than shared, same
// posture as every other cross-file validation copy in this codebase
// (e.g. pilot-view.ts's own TickerSlotInput checks vs. the
// platform-admin pilot-view.ts's identical copy).
function validateStyle(value: unknown): value is TickerStyleInput {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<TickerStyleInput>;
  return (
    typeof s.backgroundColor === "string" &&
    HEX_COLOR_PATTERN.test(s.backgroundColor) &&
    typeof s.backgroundOpacity === "number" &&
    Number.isInteger(s.backgroundOpacity) &&
    s.backgroundOpacity >= 0 &&
    s.backgroundOpacity <= 100 &&
    typeof s.heightPx === "number" &&
    Number.isInteger(s.heightPx) &&
    s.heightPx >= 24 &&
    s.heightPx <= 200 &&
    typeof s.fontFamily === "string" &&
    VALID_FONT_FAMILIES.includes(s.fontFamily) &&
    typeof s.fontSizePx === "number" &&
    Number.isInteger(s.fontSizePx) &&
    s.fontSizePx >= 8 &&
    s.fontSizePx <= 72 &&
    typeof s.fontColor === "string" &&
    HEX_COLOR_PATTERN.test(s.fontColor) &&
    typeof s.scrollSpeedPxPerSec === "number" &&
    Number.isInteger(s.scrollSpeedPxPerSec) &&
    s.scrollSpeedPxPerSec >= 0 &&
    s.scrollSpeedPxPerSec <= 200 &&
    typeof s.gapPx === "number" &&
    Number.isInteger(s.gapPx) &&
    s.gapPx >= 0 &&
    s.gapPx <= 2000
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare("SELECT id, name, styleJson, createdAt FROM pilot_ticker_style_templates WHERE organizationId = ? ORDER BY createdAt ASC")
    .bind(organizationId)
    .all<TemplateRow>();

  return jsonResponse({ templates: results.map(toResponseShape) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { name?: unknown; style?: unknown } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonResponse({ error: "Template name is required" }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: `Template name must be ${MAX_NAME_LENGTH} characters or fewer` }, 400);
  }
  if (!validateStyle(body?.style)) {
    return jsonResponse({ error: "Template style is missing or invalid" }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const styleJson = JSON.stringify(body!.style);
  await env.DB
    .prepare("INSERT INTO pilot_ticker_style_templates (id, organizationId, name, styleJson, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(id, organizationId, name, styleJson, createdAt)
    .run();

  return jsonResponse(toResponseShape({ id, name, styleJson, createdAt }), 201);
};
