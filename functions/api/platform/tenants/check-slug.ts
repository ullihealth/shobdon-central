// Platform-admin only: GET /api/platform/tenants/check-slug?slug=X -
// live-as-you-type availability check for the "Onboard New Tenant"
// form's optional custom-subdomain field (PlatformTenantsPage.tsx,
// debounced). Read-only, cheap (one indexed SELECT) - a fresh check
// every call rather than relying on the tenant list already loaded
// client-side, since that snapshot can go stale the moment another
// tenant is created elsewhere. This is advisory only, for immediate
// form feedback - onboard.ts still re-checks and, more importantly,
// relies on tenants.slug's own UNIQUE constraint (migration
// 0022_tenant_schema.sql) as the actual atomic guarantee, since a
// check-then-create sequence here can never fully close a race between
// two concurrent requests on its own.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { validateSlugCandidate } from "../../_utils/tenantSlug";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const slug = (new URL(request.url).searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return jsonResponse({ error: "slug query param is required" }, 400);

  const validation = validateSlugCandidate(slug);
  if (!validation.valid) {
    return jsonResponse({ available: false, reason: validation.error });
  }

  const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (existing) {
    return jsonResponse({ available: false, reason: "That subdomain is already taken" });
  }

  return jsonResponse({ available: true });
};
