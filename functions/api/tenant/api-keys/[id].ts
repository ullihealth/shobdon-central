// Owner-only: DELETE /api/tenant/api-keys/:id - revokes (not hard-deletes)
// a key, so ingestion history stays attributable to a real key row
// rather than an orphaned foreign key. Idempotent: revoking an
// already-revoked or nonexistent key is a safe no-op.

import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const keyId = params.id;
  if (!keyId) return jsonResponse({ error: "Missing key id" }, 400);

  // Scoped via a join back to tenants.organization_id (a key belongs to
  // a tenant, not directly to an organization) - this is what prevents
  // one tenant's owner from revoking a DIFFERENT tenant's key even if
  // they somehow guessed its id.
  await env.DB
    .prepare(
      `UPDATE tenant_api_keys SET revoked_at = datetime('now')
       WHERE id = ? AND revoked_at IS NULL AND tenant_id = (SELECT id FROM tenants WHERE organization_id = ?)`
    )
    .bind(keyId, organizationId)
    .run();

  return jsonResponse({ ok: true });
};
