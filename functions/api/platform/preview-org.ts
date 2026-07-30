// Sets the developer tenant-preview cookie (DEV_PREVIEW_ORG_COOKIE) -
// same shape as functions/api/tenant/switch-org.ts, but gated by
// requirePlatformAdmin instead of real membership, since the whole
// point is letting a developer preview a tenant they don't belong to.
// Backs /platform/preview's tenant-picker dropdown; requireTenant's own
// tier-3 resolution (tenantAuth.ts) is what actually reads this cookie
// back out on every subsequent /config, /media-manager, /runways,
// /members, or DesignPage-preview request.
import {
  requirePlatformAdmin,
  resolveDeveloperPreviewTenant,
  jsonResponse,
  DEV_PREVIEW_ORG_COOKIE,
  type D1Database,
} from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { orgSlug?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });

  // Empty/null orgSlug clears the preview (exits back to the
  // developer's own real tenant context, tier 2/4 of requireTenant's
  // resolution) - same single-endpoint shape as setting one, just a
  // Max-Age=0 cookie instead of a real value.
  if (!body.orgSlug) {
    headers.append("Set-Cookie", `${DEV_PREVIEW_ORG_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(JSON.stringify({ ok: true, organizationSlug: null }), { status: 200, headers });
  }

  const orgSlug = typeof body.orgSlug === "string" ? body.orgSlug : null;
  if (!orgSlug) return jsonResponse({ error: "orgSlug must be a string" }, 400);

  // Validated against a real org row (not membership - see
  // resolveDeveloperPreviewTenant's own comment) so the cookie never
  // gets set to a slug that doesn't exist, which would otherwise fall
  // through requireTenant's tier 3 silently to tier 4 on every request.
  const tenant = await resolveDeveloperPreviewTenant(env.DB, orgSlug);
  if (!tenant) return jsonResponse({ error: "Unknown organization slug" }, 404);

  headers.append(
    "Set-Cookie",
    `${DEV_PREVIEW_ORG_COOKIE}=${encodeURIComponent(orgSlug)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  );

  return new Response(
    JSON.stringify({ ok: true, organizationSlug: tenant.slug, organizationName: tenant.name }),
    { status: 200, headers }
  );
};
