// Owner/admin/media-role: list the tenant's uploaded media library files plus
// running usage vs. the 100MB cap. Upload/delete are separate routes
// (upload.ts, [id].ts) - this one is read-only.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { MEDIA_QUOTA_BYTES } from "../../_utils/mediaQuota";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

interface MediaLibraryRow {
  id: string;
  r2Key: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  mp4DurationSeconds: number | null;
  uploadedAt: string;
  slideRecipeJson: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare(
      "SELECT id, r2Key, filename, mediaType, sizeBytes, mp4DurationSeconds, uploadedAt, slideRecipeJson FROM media_library WHERE organizationId = ? ORDER BY uploadedAt DESC"
    )
    .bind(organizationId)
    .all<MediaLibraryRow>();

  const totalBytes = results.reduce((sum, row) => sum + row.sizeBytes, 0);

  // Resolve each file's real public URL server-side (same MEDIA_PUBLIC_BASE_URL +
  // r2Key pattern the public config endpoint uses) so the media manager can render
  // actual thumbnails instead of icon-only placeholders. The ?v= cache-buster
  // matches the public config endpoint's - needed now that a slide can be
  // edited in place (same r2Key, new bytes) - see [id]/replace.ts.
  const files = results.map(({ r2Key, slideRecipeJson, ...file }) => ({
    ...file,
    url: env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${r2Key}?v=${encodeURIComponent(file.uploadedAt)}` : null,
    // Parsed here (not left as a raw string) so the frontend never needs
    // its own JSON.parse/try-catch for this - null for every normal
    // upload, only non-null for a composer-generated slide.
    slideRecipe: slideRecipeJson ? JSON.parse(slideRecipeJson) : null,
  }));

  return jsonResponse({ files, totalBytes, capBytes: MEDIA_QUOTA_BYTES });
};
