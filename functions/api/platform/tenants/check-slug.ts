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
//
// Onboard-tool venue/café fork round - ?tenantType=venue_cafe makes this
// live-typing check enforce the same -media suffix rule onboard.ts's own
// real submission enforces below, via the same shared
// validateSlugCandidate() call, mirroring functions/api/public/
// check-slug.ts's identical ?signupType=venue_cafe handling - so this can
// never show "available" for a slug the real submission would then
// reject.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { validateSlugCandidate, CAFE_SLUG_SUFFIX } from "../../_utils/tenantSlug";

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

  const url = new URL(request.url);
  const slug = (url.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) return jsonResponse({ error: "slug query param is required" }, 400);

  const tenantType = url.searchParams.get("tenantType");
  const requiredSuffix = tenantType === "venue_cafe" ? CAFE_SLUG_SUFFIX : undefined;

  const validation = validateSlugCandidate(slug, requiredSuffix);
  if (!validation.valid) {
    return jsonResponse({ available: false, reason: validation.error });
  }

  const existing = await env.DB.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (existing) {
    return jsonResponse({ available: false, reason: "That subdomain is already taken" });
  }

  return jsonResponse({ available: true });
};
