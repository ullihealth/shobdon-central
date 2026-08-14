// Shared validate-and-store logic for the QR/phone-mockup slide's
// per-tenant mockup image (Step 1 of the rollout scoped in this
// session's investigation) - near-identical mirror of logoUpload.ts's
// own validateAndUploadLogo, deliberately kept as its own function
// rather than a generalized "upload any tenant image" helper: the two
// assets have different size budgets (see MAX_MOCKUP_BYTES below) and
// live under a different R2 key prefix/tenant column, and matching
// logoUpload.ts's own precedent of "one small dedicated helper per
// asset type" keeps each one simple to read in isolation rather than
// introducing a shared options object neither caller really needs yet.
// Also deliberately NOT routed through media_library/upload.ts, same
// reasoning as logoUpload.ts's own comment - this isn't carousel
// content and shouldn't count against the tenant's media storage quota.
import { jsonResponse, type D1Database } from "./tenantAuth";

export interface R2Bucket {
  put: (key: string, value: ReadableStream | ArrayBuffer | null, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
}

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/avif": "avif",
};

// 8MB, not the logo's 2MB - a logo is a small icon-like graphic; this is
// a full portrait phone-mockup photo/composite (a real photograph of a
// device, or a photo-realistic composite background behind it), which
// is a materially heavier kind of asset at the same visual quality.
// Still a real, bounded cap (not "whatever fits") to keep uploads fast
// and R2 storage cost predictable - 8MB comfortably covers a high-
// resolution PNG/JPEG composite without inviting arbitrarily large
// files through a developer-only, infrequently-used upload control.
const MAX_MOCKUP_BYTES = 8 * 1024 * 1024;

export async function validateAndUploadQrMockup(
  request: Request,
  env: { DB: D1Database; MEDIA: R2Bucket; MEDIA_PUBLIC_BASE_URL?: string },
  tenantSlug: string,
  organizationId: string
): Promise<{ mockupImageUrl: string } | { error: Response }> {
  const contentType = request.headers.get("content-type") || "";
  const ext = ALLOWED_CONTENT_TYPES[contentType.split(";")[0].trim().toLowerCase()];
  if (!ext) {
    return {
      error: jsonResponse(
        { error: `Unsupported image type "${contentType || "unknown"}" - please upload a PNG, JPG, SVG, WebP, or AVIF file.` },
        400
      ),
    };
  }

  const contentLengthHeader = request.headers.get("content-length");
  const sizeBytes = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { error: jsonResponse({ error: "Missing or invalid Content-Length" }, 400) };
  }
  if (sizeBytes > MAX_MOCKUP_BYTES) {
    const maxMb = (MAX_MOCKUP_BYTES / (1024 * 1024)).toFixed(0);
    const fileMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return {
      error: jsonResponse({ error: `Mockup image is ${fileMb}MB - please upload an image under ${maxMb}MB.` }, 413),
    };
  }

  // New key per upload (never overwrite in place), same convention
  // logoUpload.ts/media-library/upload.ts both use. The old key is
  // simply superseded, not deleted - negligible R2 cost for a small,
  // infrequently-replaced file.
  const r2Key = `${tenantSlug}/qr-slide/mockup-${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(r2Key, request.body, { httpMetadata: { contentType } });

  await env.DB
    .prepare("UPDATE tenants SET qr_mockup_r2_key = ?, updated_at = ? WHERE organization_id = ?")
    .bind(r2Key, new Date().toISOString(), organizationId)
    .run();

  const mockupImageUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${r2Key}` : r2Key;
  return { mockupImageUrl };
}
