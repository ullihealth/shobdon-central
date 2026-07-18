// Owner/admin: POST /api/tenant/branding/logo
// Body: raw file bytes (same streamed-to-R2 convention as
// media-library/upload.ts), Content-Type header carries the mime type.
//
// Self-service tenant branding logo upload - any owner/admin can
// replace their own tenant's logo without developer involvement. Shares
// validateAndUploadLogo with the platform-admin override route
// (functions/api/platform/tenants/[id]/logo.ts) so the R2/validation
// logic exists exactly once.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { validateAndUploadLogo, type R2Bucket } from "../../_utils/logoUpload";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  MEDIA_PUBLIC_BASE_URL?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId, slug } = result.membership;

  const outcome = await validateAndUploadLogo(request, env, slug, organizationId);
  if ("error" in outcome) return outcome.error;

  return jsonResponse(outcome);
};
