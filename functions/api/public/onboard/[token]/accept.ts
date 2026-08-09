// Public, unauthenticated: POST /api/public/onboard/:token/accept
// Body: { password, name? }
//
// Re-validates the token (same rules as [token].ts's GET), then creates
// user/account/member rows using the EXACT same pattern functions/api/
// tenant/members/index.ts's onRequestPost already uses for a new member -
// same providerId/accountId convention, same hashPassword helper - just
// with the invitee's own chosen password instead of a generated
// temporary one, and role 'owner' (they're setting up their own tenant,
// not being added to someone else's). Marks the invite used_at so it
// can never be replayed. The frontend calls authClient.signIn.email()
// itself afterward to establish a real BetterAuth session - this route
// only ever touches account creation, never sessions.
//
// email round: no longer accepted from the request body at all - reads
// tenant_invites.email instead (migration 0084_tenant_invite_email.sql,
// set once at creation time by functions/api/platform/tenants/onboard.ts
// and validated there). Previously this let whoever opened the link type
// in ANY email; now the platform admin's choice at creation time is the
// only source, matching OnboardInvitePage.tsx's own read-only display of
// it. A missing email (only possible for an invite row created before
// this column existed - all now expired/used, harmless) is a hard error
// here rather than a silent fallback to trusting client input again.
import { jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { hashPassword } from "../../../_utils/passwordHash";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface InviteRow {
  id: number;
  tenantId: number;
  organizationId: string;
  expiresAt: string;
  usedAt: string | null;
  email: string | null;
}

const MIN_PASSWORD_LENGTH = 8;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const token = params.token;
  if (!token) return jsonResponse({ error: "Missing invite token" }, 400);

  const invite = await env.DB
    .prepare(
      "SELECT id, tenant_id AS tenantId, organization_id AS organizationId, expires_at AS expiresAt, used_at AS usedAt, email FROM tenant_invites WHERE token = ?"
    )
    .bind(token)
    .first<InviteRow>();

  if (!invite) return jsonResponse({ error: "This invite link is not valid" }, 404);
  if (invite.usedAt) return jsonResponse({ error: "This invite link has already been used" }, 409);
  if (new Date(invite.expiresAt).getTime() < Date.now()) return jsonResponse({ error: "This invite link has expired" }, 410);
  if (!invite.email) return jsonResponse({ error: "This invite link is missing a required email - please request a new one" }, 400);
  const email = invite.email;

  const body = (await request.json().catch(() => null)) as { password?: unknown; name?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;

  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }

  const existingUser = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  if (existingUser) return jsonResponse({ error: "An account already exists with this email - please sign in instead" }, 409);

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await env.DB
    .prepare("INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, developer) VALUES (?, ?, ?, 0, NULL, ?, ?, 0)")
    .bind(userId, name, email, now, now)
    .run();

  await env.DB
    .prepare("INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now)
    .run();

  await env.DB
    .prepare("INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, 'owner', ?)")
    .bind(crypto.randomUUID(), invite.organizationId, userId, now)
    .run();

  await env.DB.prepare("UPDATE tenant_invites SET used_at = ? WHERE id = ?").bind(now, invite.id).run();

  return jsonResponse({ email });
};
