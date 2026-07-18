// Platform-admin only: POST /api/platform/tenants/:id/logo
// Body: raw file bytes (same convention as tenant/branding/logo.ts).
//
// Developer-override logo upload/replace - customer-service path for
// fixing a badly-sized or wrong logo on any tenant's behalf, without
// needing to sign in as that tenant. requirePlatformAdmin, same
// reasoning as the sibling [id].ts PATCH route (org-independent by
// design - see tenantAuth.ts's own comment on that helper): :id is an
// explicit path param naming which tenant to touch, completely
// independent of the caller's own resolved org.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { validateAndUploadLogo, type R2Bucket } from "../../../_utils/logoUpload";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  MEDIA_PUBLIC_BASE_URL?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await env.DB
    .prepare("SELECT slug, organization_id AS organizationId FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ slug: string; organizationId: string | null }>();
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);
  if (!tenant.organizationId) return jsonResponse({ error: "Tenant has no linked organization" }, 400);

  const outcome = await validateAndUploadLogo(request, env, tenant.slug, tenant.organizationId);
  if ("error" in outcome) return outcome.error;

  return jsonResponse(outcome);
};
