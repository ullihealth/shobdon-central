// Platform-admin only: DELETE /api/platform/ip-labels/:id - removes a
// label entirely (unlike tenant_known_devices' "retire" pattern, there's
// no audit-trail reason to keep a soft-deleted row here - this is just an
// annotation, not a billing-relevant confirmation decision).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return jsonResponse({ error: "Invalid id" }, 400);

  await env.DB.prepare("DELETE FROM ip_labels WHERE id = ?").bind(id).run();
  return jsonResponse({ ok: true });
};
