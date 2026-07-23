// Owner/admin/media/cafe-role: PATCH/DELETE /api/tenant/media-folders/:id
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const MAX_NAME_LENGTH = 60;

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const folderId = params.id;
  if (!folderId) return jsonResponse({ error: "Missing folder id" }, 400);

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return jsonResponse({ error: "Folder name is required" }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: `Folder name must be ${MAX_NAME_LENGTH} characters or fewer` }, 400);
  }

  const folder = await env.DB
    .prepare("SELECT id FROM media_folders WHERE id = ? AND organizationId = ?")
    .bind(folderId, organizationId)
    .first<{ id: string }>();
  if (!folder) return jsonResponse({ error: "Folder not found" }, 404);

  await env.DB.prepare("UPDATE media_folders SET name = ? WHERE id = ? AND organizationId = ?").bind(name, folderId, organizationId).run();

  return jsonResponse({ ok: true });
};

// Deleting a folder never deletes the files inside it - they fall back
// to the virtual "Uncategorized" bucket (folderId = NULL). Order matters:
// unlink the files BEFORE dropping the folder row, so there's never a
// window where a file's folderId points at a folder that no longer
// exists.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const folderId = params.id;
  if (!folderId) return jsonResponse({ error: "Missing folder id" }, 400);

  const folder = await env.DB
    .prepare("SELECT id FROM media_folders WHERE id = ? AND organizationId = ?")
    .bind(folderId, organizationId)
    .first<{ id: string }>();
  if (!folder) return jsonResponse({ error: "Folder not found" }, 404);

  await env.DB.prepare("UPDATE media_library SET folderId = NULL WHERE folderId = ? AND organizationId = ?").bind(folderId, organizationId).run();
  await env.DB.prepare("DELETE FROM media_folders WHERE id = ? AND organizationId = ?").bind(folderId, organizationId).run();

  return jsonResponse({ ok: true });
};
