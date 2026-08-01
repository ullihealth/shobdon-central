// Owner/admin: PATCH/DELETE /api/tenant/design-templates/:id
// See index.ts's own comment for the full "why" of this table/route.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const MAX_NAME_LENGTH = 60;

// Rename only, same as media-folders/[id].ts's own PATCH - tokens/
// gradientMode/baseColour are never edited in place today (the UI only
// ever offers Rename/Duplicate/Delete on an existing template; changing
// its colours happens by editing activeTokens and saving that as a NEW
// template instead), so there's nothing else for this route to accept
// yet.
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const templateId = params.id;
  if (!templateId) return jsonResponse({ error: "Missing template id" }, 400);

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonResponse({ error: "Template name is required" }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: `Template name must be ${MAX_NAME_LENGTH} characters or fewer` }, 400);
  }

  const existing = await env.DB
    .prepare("SELECT id FROM design_templates WHERE id = ? AND organizationId = ?")
    .bind(templateId, organizationId)
    .first<{ id: string }>();
  if (!existing) return jsonResponse({ error: "Template not found" }, 404);

  await env.DB
    .prepare("UPDATE design_templates SET name = ? WHERE id = ? AND organizationId = ?")
    .bind(name, templateId, organizationId)
    .run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const templateId = params.id;
  if (!templateId) return jsonResponse({ error: "Missing template id" }, 400);

  const existing = await env.DB
    .prepare("SELECT id FROM design_templates WHERE id = ? AND organizationId = ?")
    .bind(templateId, organizationId)
    .first<{ id: string }>();
  if (!existing) return jsonResponse({ error: "Template not found" }, 404);

  await env.DB.prepare("DELETE FROM design_templates WHERE id = ? AND organizationId = ?").bind(templateId, organizationId).run();

  return jsonResponse({ ok: true });
};
