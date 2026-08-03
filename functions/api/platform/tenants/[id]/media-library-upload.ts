// Platform-admin only: POST /api/platform/tenants/:id/media-library-upload
//   ?filename=<name>&mediaType=image|mp4|pdf&mp4DurationSeconds=<n optional>
// Body: raw file bytes - same streaming-to-R2 shape as the tenant-facing
// functions/api/tenant/media-library/upload.ts, just resolving :id's
// organizationId/slug (for the R2 key path) instead of the caller's own
// session membership, so an owner (developer role) can upload ad
// creative directly into a SPECIFIC tenant's own media_library on their
// behalf (Reserved Owner Slots & Time Budget round) - the file ends up
// as an ordinary media_library row owned by that tenant's org,
// structurally indistinguishable from anything the tenant uploaded
// themselves; only carousel-owner-slots.ts's own ownerContentAssigned
// flag (set separately, when the slot is actually assigned) marks it as
// owner-sold content once it's placed into slot 5/8/12.
//
// Counts against the target tenant's own storage_quota_bytes, same as
// any tenant upload - a deliberate simplification (not billed
// separately to the owner) rather than an oversight; flagged in this
// round's own report.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { resolveMediaQuotaBytes } from "../../../_utils/mediaQuota";

interface R2Bucket {
  put: (key: string, value: ReadableStream | ArrayBuffer | null, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
}

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
}

const ALLOWED_MEDIA_TYPES = ["image", "mp4", "pdf"];

function extensionFor(filename: string, mediaType: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < filename.length - 1) return filename.slice(dotIndex + 1).toLowerCase();
  return mediaType === "mp4" ? "mp4" : mediaType === "pdf" ? "pdf" : "jpg";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await env.DB
    .prepare("SELECT organization_id AS organizationId, slug FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ organizationId: string; slug: string }>();
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);
  const { organizationId, slug } = tenant;

  const url = new URL(request.url);
  const filename = url.searchParams.get("filename") || "upload";
  const mediaType = url.searchParams.get("mediaType") || "";
  const mp4DurationParam = url.searchParams.get("mp4DurationSeconds");
  const mp4DurationSeconds = mp4DurationParam ? Number(mp4DurationParam) : null;

  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return jsonResponse({ error: `mediaType must be one of: ${ALLOWED_MEDIA_TYPES.join(", ")}` }, 400);
  }

  const contentLengthHeader = request.headers.get("content-length");
  const sizeBytes = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return jsonResponse({ error: "Missing or invalid Content-Length" }, 400);
  }

  const [totalRow, quotaBytes] = await Promise.all([
    env.DB
      .prepare("SELECT COALESCE(SUM(sizeBytes), 0) AS total FROM media_library WHERE organizationId = ?")
      .bind(organizationId)
      .first<{ total: number }>(),
    resolveMediaQuotaBytes(env.DB, organizationId),
  ]);
  const currentTotal = totalRow?.total ?? 0;

  if (currentTotal + sizeBytes > quotaBytes) {
    const currentMb = (currentTotal / (1024 * 1024)).toFixed(1);
    const capMb = (quotaBytes / (1024 * 1024)).toFixed(0);
    const newFileMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return jsonResponse(
      {
        error: `This upload (${newFileMb}MB) would exceed this tenant's ${capMb}MB media storage limit - they're currently using ${currentMb}MB.`,
      },
      413
    );
  }

  const fileId = crypto.randomUUID();
  const ext = extensionFor(filename, mediaType);
  const r2Key = `${slug}/library/${fileId}.${ext}`;
  const contentType = request.headers.get("content-type") || undefined;

  await env.MEDIA.put(r2Key, request.body, { httpMetadata: { contentType } });

  const uploadedAt = new Date().toISOString();
  await env.DB
    .prepare(
      "INSERT INTO media_library (id, organizationId, r2Key, filename, mediaType, sizeBytes, mp4DurationSeconds, uploadedAt, folderId, usableOn, orientation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'both', '16:9')"
    )
    .bind(fileId, organizationId, r2Key, filename, mediaType, sizeBytes, mp4DurationSeconds, uploadedAt)
    .run();

  return jsonResponse({ id: fileId, filename, mediaType, sizeBytes, mp4DurationSeconds, uploadedAt });
};
