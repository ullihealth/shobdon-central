// Owner/admin/media-role: PUT /api/tenant/media-library/:id/replace
// Body: raw file bytes (same convention as upload.ts).
//
// Overwrites an EXISTING file's content IN PLACE - same id, same
// r2Key, new bytes. Used by the slide composer's primary "Save Slide"
// action when editing an existing slide (as opposed to "Save as New",
// which goes through the normal upload.ts + recipe.ts pair and creates
// a fresh row/id entirely). Any carousel slot already pointing at this
// id keeps working with zero reassignment, since mediaLibraryId and
// r2Key are both unchanged - only the bytes those already-correct
// references resolve to have changed.
//
// Quota is checked against the DELTA (currentTotal - oldSize +
// newSize), not newSize added on top of the existing total - otherwise
// re-saving a file that's already counted in the tenant's usage would
// double-count it and could reject a same-size (or even smaller) edit.
import { requireRoles, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
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

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const fileId = params.id;
  if (!fileId) return jsonResponse({ error: "Missing file id" }, 400);

  const file = await env.DB
    .prepare("SELECT r2Key, sizeBytes FROM media_library WHERE id = ? AND organizationId = ?")
    .bind(fileId, organizationId)
    .first<{ r2Key: string; sizeBytes: number }>();
  if (!file) return jsonResponse({ error: "File not found" }, 404);

  const contentLengthHeader = request.headers.get("content-length");
  const newSizeBytes = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (!Number.isFinite(newSizeBytes) || newSizeBytes <= 0) {
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
  const totalAfterReplace = currentTotal - file.sizeBytes + newSizeBytes;

  if (totalAfterReplace > quotaBytes) {
    const currentMb = (currentTotal / (1024 * 1024)).toFixed(1);
    const capMb = (quotaBytes / (1024 * 1024)).toFixed(0);
    const newFileMb = (newSizeBytes / (1024 * 1024)).toFixed(1);
    return jsonResponse(
      {
        error: `This update (${newFileMb}MB) would exceed your ${capMb}MB media storage limit - you're currently using ${currentMb}MB. Delete something from the media library first.`,
      },
      413
    );
  }

  const contentType = request.headers.get("content-type") || undefined;

  // Quota check has already passed - only now do we touch R2 or D1.
  await env.MEDIA.put(file.r2Key, request.body, { httpMetadata: { contentType } });

  // uploadedAt doubles as "last modified" here - there's no separate
  // updatedAt column, and bumping this to now is exactly the behaviour
  // wanted anyway (the media library list sorts by uploadedAt DESC, so
  // a just-edited slide naturally surfaces near the top).
  const updatedAt = new Date().toISOString();
  await env.DB
    .prepare("UPDATE media_library SET sizeBytes = ?, uploadedAt = ? WHERE id = ? AND organizationId = ?")
    .bind(newSizeBytes, updatedAt, fileId, organizationId)
    .run();

  return jsonResponse({ id: fileId, sizeBytes: newSizeBytes, uploadedAt: updatedAt });
};
