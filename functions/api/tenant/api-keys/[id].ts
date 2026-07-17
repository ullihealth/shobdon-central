// Owner-only: DELETE /api/tenant/api-keys/:id - revokes (not hard-deletes)
// a key, so ingestion history stays attributable to a real key row
// rather than an orphaned foreign key. Idempotent for a key that's
// genuinely yours: revoking an already-revoked key of your own is a
// safe no-op, still 200. A key that exists but belongs to a DIFFERENT
// tenant, or doesn't exist at all, now returns a real error status
// (403 / 404) instead of a false-success 200 - the security property
// (the row is never actually touched cross-tenant) was already correct,
// only the response was misleading about what happened.

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

  const callerTenant = await env.DB
    .prepare("SELECT id FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ id: number }>();
  if (!callerTenant) return jsonResponse({ error: "No tenant record linked to this organization" }, 404);

  // Looked up by id ALONE first (no tenant filter yet), so the caller's
  // own tenant_id can be compared against the key's actual tenant_id -
  // this is what distinguishes "doesn't exist" (404) from "exists, but
  // isn't yours" (403) rather than folding both into one response.
  const key = await env.DB.prepare("SELECT tenant_id AS tenantId FROM tenant_api_keys WHERE id = ?").bind(keyId).first<{ tenantId: number }>();
  if (!key) return jsonResponse({ error: "Key not found" }, 404);
  if (key.tenantId !== callerTenant.id) return jsonResponse({ error: "Key not found" }, 403);

  await env.DB
    .prepare("UPDATE tenant_api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
    .bind(keyId)
    .run();

  return jsonResponse({ ok: true });
};
