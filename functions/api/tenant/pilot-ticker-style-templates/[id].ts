// Owner/admin/atc: DELETE /api/tenant/pilot-ticker-style-templates/:id
// See index.ts's own comment for the full "why" of this table/route -
// same structural copy of design-templates/[id].ts, requireRoles
// instead of requireOwner. No PATCH/rename here - Pilot Panel's own
// spec only calls for save/list/apply/delete, unlike Screens Design's
// template library which also offers Rename.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const templateId = params.id;
  if (!templateId) return jsonResponse({ error: "Missing template id" }, 400);

  const existing = await env.DB
    .prepare("SELECT id FROM pilot_ticker_style_templates WHERE id = ? AND organizationId = ?")
    .bind(templateId, organizationId)
    .first<{ id: string }>();
  if (!existing) return jsonResponse({ error: "Template not found" }, 404);

  await env.DB
    .prepare("DELETE FROM pilot_ticker_style_templates WHERE id = ? AND organizationId = ?")
    .bind(templateId, organizationId)
    .run();

  return jsonResponse({ ok: true });
};
