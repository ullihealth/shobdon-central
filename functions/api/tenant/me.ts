// Lightweight "who am I / what's my role" endpoint for client-side role
// gating (RequireAuth.tsx's requireRole prop). Deliberately membership-
// gated only (requireTenant), not owner-gated - any authenticated tenant
// member needs to be able to learn their own role, including the ones
// who'll then get turned away from owner-only pages precisely because of
// what this endpoint tells them.

import { requireTenant, listUserMemberships, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;

  // Cross-tenant developer flag (functions/api/tenant/members/index.ts
  // already reads this same column to hide the developer's own row from
  // the members list) - deliberately a separate column from role, not a
  // tenant role itself, so it can gate /developertools independently of
  // whatever tenant role the developer's account happens to hold.
  const userRow = await env.DB.prepare("SELECT developer FROM user WHERE id = ?").bind(result.userId).first<{ developer: number }>();

  // memberships feeds the account/org switcher (AdminSidebar's
  // OrgSwitcher) - every org this user belongs to, not just the one the
  // current request resolved to.
  const memberships = await listUserMemberships(env.DB, result.userId);

  return jsonResponse({
    role: result.membership.role,
    organizationSlug: result.membership.slug,
    organizationName: result.membership.name,
    isDeveloper: !!userRow?.developer,
    memberships,
  });
};
