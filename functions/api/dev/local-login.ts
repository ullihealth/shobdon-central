// LOCAL DEV ONLY - GET /api/dev/local-login?email=jeffthompson@europe.com
// Creates a fresh session for an existing user and redirects to
// /platform/tenants with the session cookie set - a one-click way to get
// a working logged-in session against `wrangler pages dev` without
// needing to know/guess whatever password that LOCAL D1 file's account
// row happens to have (a separate SQLite database from production - it
// was never guaranteed to hold your real production password, even once
// the actual local-login bug elsewhere is fixed - see functions/api/
// auth/[[path]].ts's own comment on that separate, structural issue).
//
// Gated on Host starting with "localhost" - the same reasoning as that
// file's own new allowedHosts/trustedOrigins entries: no real production
// request can ever legitimately present that Host value, so this route
// is dead/404 in production with no environment flag or config needed to
// keep it that way.
//
// Deliberately bypasses password verification entirely (this IS the
// point - it's the test-login bypass half of the fix, not a login form).
// Writes a bare, unsigned session token straight into the session table
// and sets it as the cookie value verbatim - sufficient for every route
// in this app, none of which verify better-auth's own HMAC signature
// (see tenantAuth.ts's own extractSessionToken comment: only the token's
// existence/expiry in the session table is ever checked here, not a
// signature) - same shape this session's own manual D1 test-session
// inserts already relied on throughout local testing, just wrapped in an
// endpoint instead of hand-written SQL each time.
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days - generous, this is a dev convenience, not a real login

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host") ?? "";
  if (!host.toLowerCase().startsWith("localhost")) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const email = new URL(request.url).searchParams.get("email") || "jeffthompson@europe.com";
  const user = await env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: string }>();
  if (!user) {
    return jsonResponse({ error: `No user found locally with email "${email}" - check the local D1 has this account, or pass a different ?email=` }, 404);
  }

  const token = randomToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await env.DB
    .prepare("INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(`local_dev_${token.slice(0, 16)}`, user.id, token, expiresAt, now, now)
    .run();

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/platform/tenants",
      "Set-Cookie": `better-auth.session_token=${token}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax`,
    },
  });
};
