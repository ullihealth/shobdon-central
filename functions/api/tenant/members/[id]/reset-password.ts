// Owner-only "reset this member's password": POST
// /api/tenant/members/:id/reset-password. Generates a new temporary
// password and overwrites the member's credential account directly -
// same no-email mechanism as add-member (see functions/api/tenant/
// members/index.ts and the phase-0.1 investigation for why: this project
// has no email-sending infrastructure, and BetterAuth's own forgot-
// password flow is disabled without one - confirmed in
// node_modules/better-auth/dist/api/routes/password.mjs, which throws
// RESET_PASSWORD_DISABLED unless emailAndPassword.sendResetPassword is
// configured).
import { requireOwner, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { hashPassword, generateTemporaryPassword } from "../../../_utils/passwordHash";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const memberId = params.id;
  if (!memberId) return jsonResponse({ error: "Missing member id" }, 400);

  const target = await env.DB
    .prepare("SELECT userId, role FROM member WHERE id = ? AND organizationId = ?")
    .bind(memberId, organizationId)
    .first<{ userId: string; role: string }>();

  if (!target) return jsonResponse({ error: "Member not found" }, 404);
  // Consistent with the revoke endpoint - owner credentials aren't
  // managed through this owner-on-member action.
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
