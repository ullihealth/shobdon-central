// Lightweight "who am I / what's my role" endpoint for client-side role
// gating (RequireAuth.tsx's requireRole prop). Deliberately membership-
// gated only (requireTenant), not owner-gated - any authenticated tenant
// member needs to be able to learn their own role, including the ones
// who'll then get turned away from owner-only pages precisely because of
// what this endpoint tells them.

import { requireTenant, jsonResponse, type D1Database } from "../_utils/tenantAuth";

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

  return jsonResponse({ role: result.membership.role, organizationSlug: result.membership.slug });
};
