// Owner-only member management: GET lists the owner's own tenant's
// members, POST adds a new admin or atc member.
//
// POST does NOT use the organization plugin's invite/accept-invitation
// flow (see the phase-0.1 investigation for why: that flow has no
// direct-add endpoint, only email-based invite + a self-service accept
// step - not what a small club wants for "just set up their login").
// Instead this creates user/account/member rows directly in one pass,
// using the exact same PBKDF2 hashing BetterAuth's own login route
// verifies with (functions/api/_utils/passwordHash.ts), and returns a
// generated temporary password once - no email dependency at all.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { hashPassword, generateTemporaryPassword } from "../../_utils/passwordHash";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface MemberRow {
  id: string;
  role: string;
  createdAt: string;
  email: string;
  name: string | null;
}

const ADDABLE_ROLES = ["admin", "atc"];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare(
      "SELECT m.id AS id, m.role AS role, m.createdAt AS createdAt, u.email AS email, u.name AS name FROM member m JOIN user u ON u.id = m.userId WHERE m.organizationId = ? ORDER BY m.createdAt"
    )
    .bind(organizationId)
    .all<MemberRow>();

  return jsonResponse({ members: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "";

  if (!email || !email.includes("@")) return jsonResponse({ error: "A valid email is required" }, 400);
  if (!ADDABLE_ROLES.includes(role)) {
    return jsonResponse({ error: `role must be one of: ${ADDABLE_ROLES.join(", ")}` }, 400);
  }

  const existingUser = await env.DB
    .prepare("SELECT id FROM user WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  const now = new Date().toISOString();

  if (existingUser) {
    const alreadyMember = await env.DB
      .prepare("SELECT id FROM member WHERE organizationId = ? AND userId = ?")
      .bind(organizationId, existingUser.id)
      .first<{ id: string }>();
    if (alreadyMember) return jsonResponse({ error: "This person is already a member of your tenant" }, 409);

    // Existing user (e.g. already a member of a different tenant) - just
    // link them to this org. No new password: they already have one.
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

  // providerId/accountId convention confirmed from BetterAuth's own sign-up
  // handler source (see migrations/0005_seed_shobdon.sql's identical note).
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
