// Shared validate-and-store logic for tenant branding logo uploads, used
// by both the self-service route (functions/api/tenant/branding/logo.ts,
// requireOwner-gated, resolves the tenant from the caller's own session)
// and the developer-override route (functions/api/platform/tenants/
// [id]/logo.ts, requirePlatformAdmin-gated, resolves the tenant from the
// :id path param). Deliberately NOT routed through media_library/
// upload.ts - a logo isn't carousel content and shouldn't count against
// the tenant's media storage quota - but reuses the same R2 bucket
// binding and the same raw-bytes-streamed-to-R2 upload mechanism, per
// "reuse the pipeline, don't build a new one".
import { jsonResponse, type D1Database } from "./tenantAuth";

export interface R2Bucket {
  put: (key: string, value: ReadableStream | ArrayBuffer | null, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
}

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB - generous for a logo, keeps uploads fast and cheap.

export async function validateAndUploadLogo(
  request: Request,
  env: { DB: D1Database; MEDIA: R2Bucket; MEDIA_PUBLIC_BASE_URL?: string },
  tenantSlug: string,
  organizationId: string
): Promise<{ logoUrl: string } | { error: Response }> {
  const contentType = request.headers.get("content-type") || "";
  const ext = ALLOWED_CONTENT_TYPES[contentType.split(";")[0].trim().toLowerCase()];
  if (!ext) {
    return {
      error: jsonResponse(
        { error: `Unsupported image type "${contentType || "unknown"}" - please upload a PNG, JPG, SVG, or WebP file.` },
        400
      ),
    };
  }

  const contentLengthHeader = request.headers.get("content-length");
  const sizeBytes = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { error: jsonResponse({ error: "Missing or invalid Content-Length" }, 400) };
  }
  if (sizeBytes > MAX_LOGO_BYTES) {
    const maxMb = (MAX_LOGO_BYTES / (1024 * 1024)).toFixed(0);
    const fileMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return {
      error: jsonResponse({ error: `Logo file is ${fileMb}MB - please upload an image under ${maxMb}MB.` }, 413),
    };
  }

  // New key per upload (never overwrite in place) - same convention
  // media-library/upload.ts uses. The old key is simply superseded, not
  // deleted; negligible R2 cost for a small, infrequently-replaced file.
  const r2Key = `${tenantSlug}/branding/logo-${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(r2Key, request.body, { httpMetadata: { contentType } });

  await env.DB
    .prepare("UPDATE tenants SET logo_r2_key = ?, updated_at = ? WHERE organization_id = ?")
    .bind(r2Key, new Date().toISOString(), organizationId)
    .run();

  const logoUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${r2Key}` : r2Key;
  return { logoUrl };
}
