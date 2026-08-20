// LOCAL DEV ONLY - GET /api/dev/local-login?email=jeffthompson@europe.com
// Logs in as an existing user and redirects to /platform/tenants with a
// REAL, properly-signed better-auth session cookie set - a one-click way
// to get a working logged-in session against `wrangler pages dev`
// without needing to know/guess whatever password that LOCAL D1 file's
// account row happens to have (a separate SQLite database from
// production - it was never guaranteed to hold your real production
// password, even once the actual local-login bug elsewhere is fixed -
// see functions/api/auth/[[path]].ts's own comment on that separate,
// structural issue).
//
// Gated on Host starting with "localhost" - the same reasoning as that
// file's own allowedHosts/trustedOrigins entries: no real production
// request can ever legitimately present that Host value, so this route
// is dead/404 in production with no environment flag or config needed to
// keep it that way.
//
// Round 2 - the first version wrote a bare, unsigned token straight into
// the session table. That satisfies tenantAuth.ts's own lenient
// extractSessionToken (every app route, since it only checks the token's
// existence/expiry in the session table, never a signature - confirmed
// via its own comment), but NOT better-auth's own client-side
// useSession()/get-session, which DOES verify the cookie's signature -
// confirmed the hard way: RequireAuth.tsx's frontend gate calls
// authClient.useSession(), which calls that exact endpoint, so the
// bare-token version left /platform/tenants stuck showing "not logged
// in" even though every direct API call worked fine. Fixed by reusing
// better-auth's REAL sign-in flow instead of hand-rolling cookie
// signing (a real risk of getting subtly wrong) - overwrite this user's
// LOCAL-ONLY password to a fixed, well-known dev value, then self-fetch
// the app's own /api/auth/sign-in/email and forward its real, correctly-
// signed Set-Cookie verbatim. Never touches anything but this one
// account row's password hash, LOCAL D1 only (this whole route 404s in
// production before any of this runs).
import { jsonResponse, type D1Database } from "../_utils/tenantAuth";
import { hashPassword } from "../_utils/passwordHash";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

// Fixed, well-known, LOCAL DEV ONLY password - never meaningful outside
// this route (this file is 404 in production), so there's nothing to
// keep secret about a constant sitting in source.
const LOCAL_DEV_PASSWORD = "local-dev-only-password-1";

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

  const passwordHash = await hashPassword(LOCAL_DEV_PASSWORD);
  const now = new Date().toISOString();
  const existingAccount = await env.DB
    .prepare("SELECT id FROM account WHERE userId = ? AND providerId = 'credential'")
    .bind(user.id)
    .first<{ id: string }>();

  if (existingAccount) {
    await env.DB.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE id = ?").bind(passwordHash, now, existingAccount.id).run();
  } else {
    await env.DB
      .prepare("INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt) VALUES (?, ?, ?, 'credential', ?, ?, ?)")
      .bind(crypto.randomUUID(), user.id, user.id, passwordHash, now, now)
      .run();
  }

  // Self-fetch the real sign-in route - same origin, so it goes back
  // through this exact Worker/dev-server, exercising the genuine,
  // already-proven sign-in path (auth-origin-check included) rather
  // than reimplementing any part of it.
  const origin = new URL(request.url).origin;
  const signInResponse = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password: LOCAL_DEV_PASSWORD }),
  });

  if (!signInResponse.ok) {
    const detail = await signInResponse.text().catch(() => "");
    return jsonResponse({ error: "Internal sign-in failed", status: signInResponse.status, detail }, 500);
  }

  const setCookie = signInResponse.headers.get("set-cookie");
  if (!setCookie) {
    return jsonResponse({ error: "Sign-in succeeded but returned no session cookie" }, 500);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/platform/tenants",
      "Set-Cookie": setCookie,
    },
  });
};
