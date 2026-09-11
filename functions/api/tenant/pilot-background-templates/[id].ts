// Owner/admin/atc: PATCH/DELETE /api/tenant/pilot-background-templates/:id
// See index.ts's own comment for the full "why" of this table/route.
// Unlike pilot-ticker-style-templates/[id].ts (which deliberately skipped
// rename - that page's own spec only called for save/list/apply/delete),
// this round's spec explicitly asks for rename too, so this mirrors
// design-templates/[id].ts's PATCH handler in full, not the trimmed
// ticker-style copy.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const MAX_NAME_LENGTH = 60;

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
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
    .prepare("SELECT id FROM pilot_background_templates WHERE id = ? AND organizationId = ?")
    .bind(templateId, organizationId)
    .first<{ id: string }>();
  if (!existing) return jsonResponse({ error: "Template not found" }, 404);

  await env.DB
    .prepare("UPDATE pilot_background_templates SET name = ? WHERE id = ? AND organizationId = ?")
    .bind(name, templateId, organizationId)
    .run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const templateId = params.id;
  if (!templateId) return jsonResponse({ error: "Missing template id" }, 400);

  const existing = await env.DB
    .prepare("SELECT id FROM pilot_background_templates WHERE id = ? AND organizationId = ?")
    .bind(templateId, organizationId)
    .first<{ id: string }>();
  if (!existing) return jsonResponse({ error: "Template not found" }, 404);

  await env.DB.prepare("DELETE FROM pilot_background_templates WHERE id = ? AND organizationId = ?").bind(templateId, organizationId).run();

  return jsonResponse({ ok: true });
};
