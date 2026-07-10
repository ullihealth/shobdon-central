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
