// Owner/media-role: POST /api/tenant/media-library/upload
//   ?filename=<name>&mediaType=image|mp4|pdf&mp4DurationSeconds=<n optional>
// Body: raw file bytes (not multipart - a Pages Function streaming
// straight to R2 via request.body avoids buffering the whole file in
// memory, and avoids needing a multipart parser).
//
// Quota check happens BEFORE any R2 write: Content-Length is trusted as
// the file's size (browsers set this accurately for a fetch() with a
// File/Blob body - this isn't an adversarial upload surface, it's this
// project's own owner/media-gated UI), summed against the tenant's
// existing media_library total, and rejected outright if it would push
// the tenant over the 100MB cap - so a rejected upload never partially
// writes to R2 or creates a library row.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { MEDIA_QUOTA_BYTES } from "../../_utils/mediaQuota";

interface R2Bucket {
  put: (key: string, value: ReadableStream | ArrayBuffer | null, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
}

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
}

const ALLOWED_MEDIA_TYPES = ["image", "mp4", "pdf"];

function extensionFor(filename: string, mediaType: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < filename.length - 1) return filename.slice(dotIndex + 1).toLowerCase();
  // Fallback if the filename has no extension - shouldn't normally happen
  // given real file uploads, but keeps the R2 key sane either way.
  return mediaType === "mp4" ? "mp4" : mediaType === "pdf" ? "pdf" : "jpg";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "media"]);
  if ("error" in result) return result.error;
  const { organizationId, slug } = result.membership;

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

  const totalRow = await env.DB
    .prepare("SELECT COALESCE(SUM(sizeBytes), 0) AS total FROM media_library WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ total: number }>();
  const currentTotal = totalRow?.total ?? 0;

  if (currentTotal + sizeBytes > MEDIA_QUOTA_BYTES) {
    const currentMb = (currentTotal / (1024 * 1024)).toFixed(1);
    const capMb = (MEDIA_QUOTA_BYTES / (1024 * 1024)).toFixed(0);
    const newFileMb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return jsonResponse(
      {
        error: `This upload (${newFileMb}MB) would exceed your ${capMb}MB media storage limit - you're currently using ${currentMb}MB. Delete something from the media library first.`,
      },
      413
    );
  }

  const fileId = crypto.randomUUID();
  const ext = extensionFor(filename, mediaType);
  const r2Key = `${slug}/library/${fileId}.${ext}`;
  const contentType = request.headers.get("content-type") || undefined;

  // Quota check has already passed - only now do we touch R2 or D1.
  await env.MEDIA.put(r2Key, request.body, { httpMetadata: { contentType } });

  const uploadedAt = new Date().toISOString();
  await env.DB
    .prepare(
      "INSERT INTO media_library (id, organizationId, r2Key, filename, mediaType, sizeBytes, mp4DurationSeconds, uploadedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(fileId, organizationId, r2Key, filename, mediaType, sizeBytes, mp4DurationSeconds, uploadedAt)
    .run();

  return jsonResponse({
    id: fileId,
    filename,
    mediaType,
    sizeBytes,
    mp4DurationSeconds,
    uploadedAt,
  });
};
