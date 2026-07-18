// Any authenticated tenant member: POST /api/tenant/terms/accept
// requireTenant, NOT requireOwner - consent is individual, not an
// owner-only action, matching how a second member added later could
// accept independently too.
import { requireTenant, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;

  await env.DB
    .prepare("UPDATE user SET termsAcceptedAt = ? WHERE id = ?")
    .bind(new Date().toISOString(), result.userId)
    .run();

  return jsonResponse({ ok: true });
};
