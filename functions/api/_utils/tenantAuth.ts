// Shared "is this user logged in AND does this user belong to the tenant
// they're trying to read/write" check, used by every authenticated
// functions/api/tenant/* route. Pattern confirmed from proven-ai's own
// working getSessionUserId implementation
// (functions/api/manage/notes/index.ts): call BetterAuth's own
// /api/auth/get-session route internally, forwarding the incoming
// request's cookies, rather than re-implementing session/cookie parsing.

// Named (not inline) so functions/api/platform/tenants/[id]/hard-delete.ts
// can type its own batch() array against exactly what .prepare().bind()
// already returns - structurally identical to the previous inline
// shape, so every existing .prepare().bind().run()/first()/all() caller
// is unaffected.
export type D1BoundStatement = {
  run: () => Promise<{ success: boolean }>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
};

export type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => D1BoundStatement;
    first: <T = Record<string, unknown>>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
  // Optional, not required - other files declare their own structurally-
  // similar-but-narrower local D1Database type and pass env.DB into
  // shared helpers typed against THIS one (e.g. ingest/weather.ts's own
  // Env.DB into resolveApiKey), so a required new field here would
  // break those call sites even though they never touch batch()
  // themselves. Only added for hard-delete.ts's atomic multi-table
  // delete - every other route still uses individual .run() calls.
  batch?: (statements: D1BoundStatement[]) => Promise<unknown[]>;
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
  name: string;
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
        "SELECT m.organizationId AS organizationId, o.slug AS slug, o.name AS name, m.role AS role FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? AND o.slug = ?"
      )
      .bind(userId, requestedSlug)
      .first<TenantMembership>();
    return row ?? null;
  }

  const row = await db
    .prepare(
      "SELECT m.organizationId AS organizationId, o.slug AS slug, o.name AS name, m.role AS role FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? ORDER BY m.createdAt LIMIT 1"
    )
    .bind(userId)
    .first<TenantMembership>();
  return row ?? null;
}

export interface UserMembershipSummary {
  slug: string;
  name: string;
  role: string;
}

// Every org the user belongs to, for the account/org switcher (functions/
// api/tenant/me.ts's `memberships` field) - ordered the same way the
// no-?org= default resolves (earliest membership first), so the
// switcher's default selection always matches what a plain page load
// with no override would already show.
export async function listUserMemberships(db: D1Database, userId: string): Promise<UserMembershipSummary[]> {
  const rows = await db
    .prepare(
      "SELECT o.slug AS slug, o.name AS name, m.role AS role FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? ORDER BY m.createdAt"
    )
    .bind(userId)
    .all<UserMembershipSummary>();
  return rows.results;
}

export const ACTIVE_ORG_COOKIE = "aic-active-org";

function getCookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    if (part.slice(0, separatorIndex).trim() === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return null;
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

  let membership: TenantMembership | null;

  // Explicit ?org= is a direct-link override (bookmarks, pasted URLs) and
  // keeps its existing hard-403-if-not-a-member behaviour untouched.
  const explicitOrgSlug = new URL(request.url).searchParams.get("org");
  if (explicitOrgSlug) {
    membership = await resolveTenantMembership(env.DB, userId, explicitOrgSlug);
    if (!membership) return { error: jsonResponse({ error: "Forbidden" }, 403) };
  } else {
    // No ?org= - try the switcher's remembered choice next, but fall back
    // to the original default (earliest membership by createdAt) if the
    // cookie is missing or stale (e.g. access to that org was revoked
    // after the cookie was set). A stale cookie should never lock someone
    // out entirely; it should just behave as if it weren't there.
    const cookieOrgSlug = getCookieValue(request, ACTIVE_ORG_COOKIE);
    membership = cookieOrgSlug ? await resolveTenantMembership(env.DB, userId, cookieOrgSlug) : null;
    if (!membership) {
      membership = await resolveTenantMembership(env.DB, userId, null);
      if (!membership) return { error: jsonResponse({ error: "Forbidden" }, 403) };
    }
  }

  // Migration 0044 - archived tenant. A single choke point applied
  // regardless of which branch above resolved membership, same
  // reasoning as resolveTenantHost.ts's own active=1 check being the
  // one place that gates the public dashboard. Deliberately stronger
  // than pause (active=0 alone, which this function never checked at
  // all before this) - resolveTenantHost.ts's own comment already
  // documents that a paused tenant's back-office stays reachable; an
  // archived one should not, since archiving is meant to mean "this
  // tenant is genuinely gone," not "temporarily off." Treated
  // identically to "not a member" (403) - an archived tenant's own
  // logged-in users see the same outcome as someone who was never a
  // member at all.
  const tenantRow = await env.DB
    .prepare("SELECT deleted_at AS deletedAt FROM tenants WHERE organization_id = ?")
    .bind(membership.organizationId)
    .first<{ deletedAt: string | null }>();
  if (tenantRow?.deletedAt) return { error: jsonResponse({ error: "Forbidden" }, 403) };

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

export interface RequirePlatformAdminResult {
  userId: string;
}

export type RequirePlatformAdminOutcome = RequirePlatformAdminResult | { error: Response };

// Platform-admin gate for functions/api/platform/* - deliberately does
// NOT go through requireTenant. requireDeveloper above wraps
// requireTenant, which means it needs org-membership resolution to
// succeed FIRST (whichever org ?org=/the switcher cookie/the earliest-
// membership default lands on) before it even looks at user.developer -
// fine for /developertools and developer-settings (both act on one
// specific org's own data), but wrong here: this was tested directly
// (disposable local accounts, see the platform-tenants build) and an
// explicit ?org=<an-org-the-developer-isn't-a-member-of> produced a 403
// from requireTenant's own membership check, before requireDeveloper's
// developer-flag check ever ran - a real platform admin got locked out
// of cross-tenant tooling by org-switcher state, exactly the failure
// mode this page must never have. This check only ever asks two
// questions - is there a valid session, and does that user have
// developer=1 - with no dependency on org membership, ?org=, or the
// switcher cookie at all, so it behaves identically no matter which
// org (if any) the caller currently belongs to or is switched to.
export async function requirePlatformAdmin(request: Request, env: { DB: D1Database }): Promise<RequirePlatformAdminOutcome> {
  const userId = await getSessionUserId(request);
  if (!userId) return { error: jsonResponse({ error: "Unauthorized" }, 401) };

  const userRow = await env.DB.prepare("SELECT developer FROM user WHERE id = ?").bind(userId).first<{ developer: number }>();
  if (!userRow?.developer) {
    return { error: jsonResponse({ error: "Developer access required" }, 403) };
  }
  return { userId };
}
