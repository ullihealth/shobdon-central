// Platform-admin only: DELETE /api/platform/tenants/:id/members/:memberId
// - mirrors functions/api/tenant/members/[id].ts's onRequestDelete
// exactly, scoped by the :id path param's resolved organizationId
// instead of the caller's own session membership. Deleting the member
// row is the entire revocation mechanism, same as the tenant-facing
// route - requireTenant/requireOwner already require a live member row
// on every request, so this takes effect immediately on that member's
// very next request.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../../_utils/tenantAuth";

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

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await env.DB
    .prepare("SELECT organization_id AS organizationId FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ organizationId: string | null }>();
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);
  if (!tenant.organizationId) return jsonResponse({ error: "This tenant has no linked organization" }, 400);

  const memberId = params.memberId;
  if (!memberId) return jsonResponse({ error: "Missing member id" }, 400);

  // Scoped to the resolved tenant's own organizationId - a member id
  // from a different tenant simply won't match, same "trust the WHERE
  // clause, not the id alone" posture as the tenant-facing route.
  const target = await env.DB
    .prepare("SELECT role FROM member WHERE id = ? AND organizationId = ?")
    .bind(memberId, tenant.organizationId)
    .first<{ role: string }>();

  if (!target) return jsonResponse({ error: "Member not found" }, 404);
  if (target.role === "owner") return jsonResponse({ error: "Cannot remove an owner via this endpoint" }, 400);

  await env.DB.prepare("DELETE FROM member WHERE id = ? AND organizationId = ?").bind(memberId, tenant.organizationId).run();

  return jsonResponse({ ok: true });
};
