// Owner/admin/atc: GET/POST /api/tenant/pilot-background-templates
//
// Server-persisted custom Pilot Panel colour-scheme templates - direct
// structural copy of functions/api/tenant/pilot-ticker-style-templates/
// index.ts (itself a copy of design-templates/index.ts's own shape: id/
// organizationId/name/<blob>Json/createdAt, same GET-list/POST-create
// split, same "named saved LIST of alternates, not the one currently-
// applied value" distinction from pilot_background_override_json).
// requireRoles(['owner','admin','atc']) matches every other Pilot Panel
// endpoint's access list, not design-templates' owner-only gate.
//
// Deliberately its own table (migration 0104, not a `scope` column on
// design_templates) - see that migration's own comment for why this
// mirrors the pilot_ticker_style_templates precedent instead.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

// Same shape as pilot-view.ts's own BackgroundOverrideInput - duplicated
// rather than shared, same posture as every other cross-file validation
// copy in this codebase (e.g. that file's own TickerSlotInput vs the
// platform-admin mirror's identical copy).
interface BackgroundOverrideInput {
  backgroundColor: string;
  compassDiscBg?: string;
  compassRing?: string;
  compassCardinal?: string;
  compassMarkers?: string;
  panelBg?: string;
  cardBg?: string;
  textColor?: string;
  compassBearingLabels?: string;
}

const OPTIONAL_THEME_COLOR_FIELDS = [
  "compassDiscBg",
  "compassRing",
  "compassCardinal",
  "compassMarkers",
  "panelBg",
  "cardBg",
  "textColor",
  "compassBearingLabels",
] as const;

interface TemplateRow {
  id: string;
  name: string;
  themeJson: string;
  createdAt: string;
}

interface TemplateResponse {
  id: string;
  name: string;
  theme: BackgroundOverrideInput;
  createdAt: string;
}

function toResponseShape(row: TemplateRow): TemplateResponse {
  return {
    id: row.id,
    name: row.name,
    theme: JSON.parse(row.themeJson) as BackgroundOverrideInput,
    createdAt: row.createdAt,
  };
}

const MAX_NAME_LENGTH = 60;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Same validation shape as pilot-view.ts's own PUT handler - backgroundColor
// required, every other field independently optional and only checked
// when present.
function validateTheme(value: unknown): value is BackgroundOverrideInput {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<BackgroundOverrideInput>;
  if (typeof t.backgroundColor !== "string" || !HEX_COLOR_PATTERN.test(t.backgroundColor)) return false;
  for (const key of OPTIONAL_THEME_COLOR_FIELDS) {
    const fieldValue = t[key];
    if (fieldValue !== undefined && (typeof fieldValue !== "string" || !HEX_COLOR_PATTERN.test(fieldValue))) return false;
  }
  return true;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare("SELECT id, name, themeJson, createdAt FROM pilot_background_templates WHERE organizationId = ? ORDER BY createdAt ASC")
    .bind(organizationId)
    .all<TemplateRow>();

  return jsonResponse({ templates: results.map(toResponseShape) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { name?: unknown; theme?: unknown } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonResponse({ error: "Template name is required" }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: `Template name must be ${MAX_NAME_LENGTH} characters or fewer` }, 400);
  }
  if (!validateTheme(body?.theme)) {
    return jsonResponse({ error: "Template theme is missing or invalid" }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const themeJson = JSON.stringify(body!.theme);
  await env.DB
    .prepare("INSERT INTO pilot_background_templates (id, organizationId, name, themeJson, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(id, organizationId, name, themeJson, createdAt)
    .run();

  return jsonResponse(toResponseShape({ id, name, themeJson, createdAt }), 201);
};
