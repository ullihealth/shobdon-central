// Platform-admin only: POST /api/platform/tenants/:id/members - add a
// member to an ARBITRARY tenant, not the caller's own org. Mirrors
// functions/api/tenant/members/index.ts's onRequestPost almost exactly
// (same direct-create mechanism: no BetterAuth invite/email flow, a
// generated temporary password shown once, PBKDF2-hashed the same way
// login verifies against) - the only real difference is that this
// resolves organizationId from the :id path param instead of the
// caller's own session-resolved membership, same reasoning as every
// other functions/api/platform/tenants/* route (requirePlatformAdmin,
// not requireOwner - see tenantAuth.ts's own comment on that distinction).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../../_utils/tenantAuth";
import { hashPassword, generateTemporaryPassword } from "../../../../_utils/passwordHash";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

// 'cafe' included here (unlike the tenant-facing ADDABLE_ROLES this
// mirrors) - migration/round adding the cafe role; kept in sync with
// functions/api/tenant/members/index.ts's own list and MembersPage.tsx's
// client-side one.
const ADDABLE_ROLES = ["admin", "atc", "media", "cafe"];

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
  const organizationId = tenant.organizationId;

  const body = (await request.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "";

  if (!email || !email.includes("@")) return jsonResponse({ error: "A valid email is required" }, 400);
  if (!ADDABLE_ROLES.includes(role)) {
    return jsonResponse({ error: `role must be one of: ${ADDABLE_ROLES.join(", ")}` }, 400);
  }

  const existingUser = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();

  const now = new Date().toISOString();

  if (existingUser) {
    const alreadyMember = await env.DB
      .prepare("SELECT id FROM member WHERE organizationId = ? AND userId = ?")
      .bind(organizationId, existingUser.id)
      .first<{ id: string }>();
    if (alreadyMember) return jsonResponse({ error: "This person is already a member of this tenant" }, 409);

    await env.DB
      .prepare("INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), organizationId, existingUser.id, role, now)
      .run();

    return jsonResponse({ email, role, temporaryPassword: null, existingUser: true });
  }

  const userId = crypto.randomUUID();
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await env.DB
    .prepare("INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, developer) VALUES (?, NULL, ?, 0, NULL, ?, ?, 0)")
    .bind(userId, email, now, now)
    .run();

  await env.DB
    .prepare("INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now)
    .run();

  await env.DB
    .prepare("INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), organizationId, userId, role, now)
    .run();

  return jsonResponse({ email, role, temporaryPassword, existingUser: false });
};
