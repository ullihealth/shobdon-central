// Owner/admin: GET/POST /api/tenant/design-templates
//
// Real backend persistence for Screens Design's "Save as template"
// custom colour-theme library (Backgrounds tab, Custom sub-view) -
// previously localStorage-only (src/services/designTemplateStore.ts),
// confirmed last round to never reach any tenant's actual account, only
// the one browser it was saved in. requireOwner, not requireRoles with
// a broader list - matches every other /design-backing route (this
// whole page is owner/admin-only, unlike e.g. media-folders which
// several roles can use).
//
// Deliberately NOT the same table as club_theme: club_theme is the
// tenant's own single CURRENTLY-APPLIED theme (one row, upserted by
// PUT /api/tenant/config); this is a named, saved LIST of alternates a
// tenant can pick from and apply later - genuinely a different concept
// that happened to share a UI page, not the same data reshaped.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface DesignTemplateRow {
  id: string;
  name: string;
  tokensJson: string;
  gradientMode: string;
  baseColour: string | null;
  createdAt: string;
}

interface DesignTemplateResponse {
  id: string;
  name: string;
  tokens: Record<string, string>;
  gradientMode: "solid" | "gradient";
  baseColour?: string;
  createdAt: string;
}

function toResponseShape(row: DesignTemplateRow): DesignTemplateResponse {
  return {
    id: row.id,
    name: row.name,
    tokens: JSON.parse(row.tokensJson) as Record<string, string>,
    gradientMode: row.gradientMode === "solid" ? "solid" : "gradient",
    ...(row.baseColour ? { baseColour: row.baseColour } : {}),
    createdAt: row.createdAt,
  };
}

const MAX_NAME_LENGTH = 60;

// Not the exact 26-key DESIGN_TOKEN_KEYS allowlist designTemplateStore.
// ts's own isValidDesignTokens() enforces client-side (that check exists
// for JSON-file-import safety, guarding against a hand-edited/corrupt
// file) - this only needs to guarantee what's actually stored is safe
// to JSON.stringify and safe to read back as Record<string, string>,
// which every real caller (handleSaveAsTemplate/handleDuplicate/
// handleImportFile/the one-time legacy-import flow) already guarantees
// on its own. Rejects anything that isn't a plain object of string
// values - the one shape that would actually break rendering later.
function isPlainStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare("SELECT id, name, tokensJson, gradientMode, baseColour, createdAt FROM design_templates WHERE organizationId = ? ORDER BY createdAt ASC")
    .bind(organizationId)
    .all<DesignTemplateRow>();

  return jsonResponse({ templates: results.map(toResponseShape) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    tokens?: unknown;
    gradientMode?: unknown;
    baseColour?: unknown;
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonResponse({ error: "Template name is required" }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: `Template name must be ${MAX_NAME_LENGTH} characters or fewer` }, 400);
  }
  if (!isPlainStringRecord(body?.tokens)) {
    return jsonResponse({ error: "Template tokens are missing or invalid" }, 400);
  }
  const gradientMode = body?.gradientMode === "solid" ? "solid" : "gradient";
  const baseColour = typeof body?.baseColour === "string" && body.baseColour.trim() ? body.baseColour.trim() : null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB
    .prepare("INSERT INTO design_templates (id, organizationId, name, tokensJson, gradientMode, baseColour, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, organizationId, name, JSON.stringify(body!.tokens), gradientMode, baseColour, createdAt)
    .run();

  return jsonResponse(
    toResponseShape({ id, name, tokensJson: JSON.stringify(body!.tokens), gradientMode, baseColour, createdAt }),
    201
  );
};
