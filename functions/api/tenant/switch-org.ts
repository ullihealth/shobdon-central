// Sets the account/org switcher's remembered choice. Re-validates
// membership against a live DB row on every call - never trusts the
// client's claim that it belongs to the requested org, the same rule
// every other functions/api/tenant/* route follows via requireTenant.
// Does not itself require an existing valid org context (a stale/none
// cookie shouldn't block switching to a *different*, valid org), so
// this checks the session directly rather than going through
// requireTenant.

import { getSessionUserId, resolveTenantMembership, jsonResponse, ACTIVE_ORG_COOKIE, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as { orgSlug?: unknown } | null;
  const orgSlug = typeof body?.orgSlug === "string" ? body.orgSlug : null;
  if (!orgSlug) return jsonResponse({ error: "orgSlug is required" }, 400);

  const membership = await resolveTenantMembership(env.DB, userId, orgSlug);
  if (!membership) return jsonResponse({ error: "Not a member of that organization" }, 403);

  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(orgSlug)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  );

  return new Response(
    JSON.stringify({ ok: true, organizationSlug: membership.slug, organizationName: membership.name, role: membership.role }),
    { status: 200, headers }
  );
};
