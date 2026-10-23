// Platform-admin only: POST /api/platform/tenants/:id/revoke-sessions
// "Log everyone out" - revokes every active session of that tenant's
// NON-developer members (see _utils/revokeTenantSessions.ts for exactly who is
// and isn't affected). Suspend does the same automatically.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { revokeNonDeveloperSessions } from "../../../_utils/revokeTenantSessions";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requirePlatformAdmin(request, env);
  if ("error" in auth) return auth.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);
  const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(tenantId).first();
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);

  return jsonResponse({ ok: true, ...(await revokeNonDeveloperSessions(env.DB, tenantId)) });
};
