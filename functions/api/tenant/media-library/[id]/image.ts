// Owner/admin/media-role: GET /api/tenant/media-library/:id/image
//
// Same-origin passthrough of an R2 object's bytes, used ONLY by the
// slide composer to load an existing library image as a canvas
// background. The public R2 bucket (pub-*.r2.dev, used everywhere else
// in this app) doesn't send CORS headers, so loading it directly into
// a <canvas> taints the canvas and canvas.toDataURL() throws when
// flattening. Streaming the same bytes from this app's own origin
// sidesteps that entirely - no CORS needed for a same-origin request,
// and no change to the R2 bucket's public access/policy was made for
// this (deliberately - CORS is a shared-infrastructure setting, this
// endpoint is ordinary tenant-scoped app code).
import { requireRoles, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  get: (key: string) => Promise<R2ObjectBody | null>;
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const fileId = params.id;
  if (!fileId) return jsonResponse({ error: "Missing file id" }, 400);

  const file = await env.DB
    .prepare("SELECT r2Key, mediaType FROM media_library WHERE id = ? AND organizationId = ?")
    .bind(fileId, organizationId)
    .first<{ r2Key: string; mediaType: string }>();
  if (!file) return jsonResponse({ error: "File not found" }, 404);

  const object = await env.MEDIA.get(file.r2Key);
  if (!object) return jsonResponse({ error: "File not found in storage" }, 404);

  // No caching: a slide can now be edited in place (same id/r2Key, new
  // bytes - see [id]/replace.ts), and this endpoint is what the editor
  // itself uses to load a source image for a background or layered
  // image element. A cached response here could show a just-replaced
  // file's OLD content within the same editing session.
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
};
