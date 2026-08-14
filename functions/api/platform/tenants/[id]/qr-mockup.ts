// Platform-admin only: POST /api/platform/tenants/:id/qr-mockup
// Body: raw file bytes (same convention as tenants/[id]/logo.ts).
//
// QR/phone-mockup slide per-tenant image upload, Step 1 of the rollout
// scoped in this session's investigation - direct mirror of
// tenants/[id]/logo.ts. Developer-only (no self-service route exists
// for this, unlike logos which also have a tenant-facing branding
// editor) - per this feature's own spec, the developer uploads/
// configures this per tenant, not the tenant themselves.
// requirePlatformAdmin, same reasoning as logo.ts's own comment: :id is
// an explicit path param naming which tenant to touch, completely
// independent of the caller's own resolved org.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { validateAndUploadQrMockup, type R2Bucket } from "../../../_utils/qrMockupUpload";

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

  const outcome = await validateAndUploadQrMockup(request, env, tenant.slug, tenant.organizationId);
  if ("error" in outcome) return outcome.error;

  return jsonResponse(outcome);
};
