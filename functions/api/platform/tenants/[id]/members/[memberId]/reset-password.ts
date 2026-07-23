// Platform-admin only: POST /api/platform/tenants/:id/members/:memberId/
// reset-password - mirrors functions/api/tenant/members/[id]/
// reset-password.ts exactly, scoped by the :id path param's resolved
// organizationId instead of the caller's own session membership. Same
// no-email mechanism as the tenant-facing route (this project has no
// email-sending infrastructure, and BetterAuth's own forgot-password
// flow is disabled without one) - generates a new temporary password and
// overwrites the member's credential account directly.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../../../_utils/tenantAuth";
import { hashPassword, generateTemporaryPassword } from "../../../../../_utils/passwordHash";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
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

  const target = await env.DB
    .prepare("SELECT userId, role FROM member WHERE id = ? AND organizationId = ?")
    .bind(memberId, tenant.organizationId)
    .first<{ userId: string; role: string }>();

  if (!target) return jsonResponse({ error: "Member not found" }, 404);
  if (target.role === "owner") return jsonResponse({ error: "Cannot reset an owner's password via this endpoint" }, 400);

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const now = new Date().toISOString();

  await env.DB
    .prepare("UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'")
    .bind(passwordHash, now, target.userId)
    .run();

  return jsonResponse({ temporaryPassword });
};
