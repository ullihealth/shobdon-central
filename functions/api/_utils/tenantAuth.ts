// Shared "is this user logged in AND does this user belong to the tenant
// they're trying to read/write" check, used by every authenticated
// functions/api/tenant/* route. Pattern confirmed from proven-ai's own
// working getSessionUserId implementation
// (functions/api/manage/notes/index.ts): call BetterAuth's own
// /api/auth/get-session route internally, forwarding the incoming
// request's cookies, rather than re-implementing session/cookie parsing.

export type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ success: boolean }>;
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results: T[] }>;
    };
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
};

interface SessionResponse {
  data?: { user?: { id?: string } };
  user?: { id?: string };
}

export async function getSessionUserId(request: Request): Promise<string | null> {
  const origin = new URL(request.url).origin;
  const res = await fetch(`${origin}/api/auth/get-session`, {
    method: "GET",
    headers: { cookie: request.headers.get("cookie") || "" },
  }).catch(() => null);

  if (!res || !res.ok) return null;
  // BetterAuth's get-session route responds with a literal JSON `null`
  // body (not `{}`) when there's no active session - guard with `?.`
  // from the very first property access, not just the nested ones.
  const data = (await res.json().catch(() => null)) as SessionResponse | null;
  return data?.data?.user?.id || data?.user?.id || null;
}

export interface TenantMembership {
  organizationId: string;
  slug: string;
  role: string;
}

// Resolves which tenant a logged-in user's request is scoped to:
// - ?org=<slug> given -> that org, but ONLY if the user is actually a
//   member of it (403 otherwise) - this is the actual "does this user
//   belong to the tenant" enforcement, not just "is this a real org".
// - no ?org= given -> the user's first (in phase 0, only) membership.
export async function resolveTenantMembership(
  db: D1Database,
  userId: string,
  requestedSlug: string | null
): Promise<TenantMembership | null> {
  if (requestedSlug) {
    const row = await db
      .prepare(
        "SELECT m.organizationId AS organizationId, o.slug AS slug, m.role AS role FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? AND o.slug = ?"
      )
      .bind(userId, requestedSlug)
      .first<TenantMembership>();
    return row ?? null;
  }

  const row = await db
    .prepare(
      "SELECT m.organizationId AS organizationId, o.slug AS slug, m.role AS role FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? ORDER BY m.createdAt LIMIT 1"
    )
    .bind(userId)
    .first<TenantMembership>();
  return row ?? null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export type RequireTenantResult =
  | { membership: TenantMembership; userId: string }
  | { error: Response };

// Shared "logged in AND a member of the target tenant" gate - originally
// duplicated inline in tenant/config.ts; promoted here so the member-
// management endpoints (list/add/revoke/reset-password) and the
// lightweight tenant/me role-check endpoint can all reuse the exact same
// check rather than re-implementing it.
export async function requireTenant(request: Request, env: { DB: D1Database }): Promise<RequireTenantResult> {
  const userId = await getSessionUserId(request);
  if (!userId) return { error: jsonResponse({ error: "Unauthorized" }, 401) };

  const orgSlug = new URL(request.url).searchParams.get("org");
  const membership = await resolveTenantMembership(env.DB, userId, orgSlug);
  if (!membership) return { error: jsonResponse({ error: "Forbidden" }, 403) };

  return { membership, userId };
}

// Same as requireTenant, but additionally requires the caller's role to
// be one of `allowed` - the general form used by every role-gated route
// and page. Deliberately checks membership.role directly against plain
// strings rather than going through the organization plugin's own
// role-string validation (its update-member-role endpoint validates
// against a fixed default role set that doesn't include 'atc'/'media') -
// this project writes/reads member.role with plain SQL throughout,
// sidestepping that entirely.
export async function requireRoles(
  request: Request,
  env: { DB: D1Database },
  allowed: string[]
): Promise<RequireTenantResult> {
  const result = await requireTenant(request, env);
  if ("error" in result) return result;
  if (!allowed.includes(result.membership.role)) {
    return { error: jsonResponse({ error: `Role must be one of: ${allowed.join(", ")}` }, 403) };
  }
  return result;
}

// Thin wrapper over requireRoles(['owner', 'admin']) - used by every
// existing owner-only route (member-management, /config, /design,
// /runways). 'admin' is a full alias of 'owner' (original design intent
// - the e5aa79a deploy incorrectly scoped admin down to media-manager-
// only access instead), so it's included here rather than in a separate
// check - every route gated via requireOwner gets this automatically.
export async function requireOwner(request: Request, env: { DB: D1Database }): Promise<RequireTenantResult> {
  return requireRoles(request, env, ["owner", "admin"]);
}

// Cross-tenant developer flag (u.developer, same column functions/api/
// tenant/me.ts and members/index.ts already read) - NOT a tenant role,
// so this is deliberately separate from requireOwner/requireRoles. The
// real developer account also holds 'owner' role at Shobdon today, but
// a role-only check would let every other owner/admin through too -
// this is the server-side enforcement matching RequireAuth.tsx's
// client-side requireDeveloper gate, since a client-only check is
// trivially bypassable by any authenticated member hitting the route
// directly with their own session cookie.
export async function requireDeveloper(request: Request, env: { DB: D1Database }): Promise<RequireTenantResult> {
  const result = await requireTenant(request, env);
  if ("error" in result) return result;
  const userRow = await env.DB.prepare("SELECT developer FROM user WHERE id = ?").bind(result.userId).first<{ developer: number }>();
  if (!userRow?.developer) {
    return { error: jsonResponse({ error: "Developer access required" }, 403) };
  }
  return result;
}
