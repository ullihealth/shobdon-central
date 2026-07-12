// Owner/admin/media-role: PUT /api/tenant/media-library/:id/recipe
//
// Attaches (or replaces) the slide "recipe" JSON on an existing
// media_library row - narrow, single-purpose endpoint, deliberately
// separate from upload.ts rather than folding this into it. The
// slide-composer flow is: (1) flatten the canvas to a PNG client-side,
// (2) POST it to the existing, completely unmodified upload.ts exactly
// like any photo upload, (3) PUT the recipe here against the id upload.ts
// returned. Keeping this separate means upload.ts never has to know
// slides exist, and a plain photo upload is never at risk of this
// endpoint's validation/logic.
import { requireRoles, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const fileId = params.id;
  if (!fileId) return jsonResponse({ error: "Missing file id" }, 400);

  const body = (await request.json().catch(() => null)) as { recipe?: unknown } | null;
  if (!body || typeof body.recipe !== "object" || body.recipe === null) {
    return jsonResponse({ error: "Missing recipe object in request body" }, 400);
  }

  const file = await env.DB
    .prepare("SELECT id FROM media_library WHERE id = ? AND organizationId = ?")
    .bind(fileId, organizationId)
    .first<{ id: string }>();
  if (!file) return jsonResponse({ error: "File not found" }, 404);

  await env.DB
    .prepare("UPDATE media_library SET slideRecipeJson = ? WHERE id = ? AND organizationId = ?")
    .bind(JSON.stringify(body.recipe), fileId, organizationId)
    .run();

  return jsonResponse({ ok: true });
};
