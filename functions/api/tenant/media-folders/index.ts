// Owner/admin/media-role: GET/POST /api/tenant/media-folders
//
// A flat, user-defined list of folders per tenant - no nesting. The
// "Uncategorized" bucket shown in the UI is virtual (media_library rows
// with folderId IS NULL) and never has a row here; it isn't listed by
// this GET, the frontend always shows it first regardless.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface FolderRow {
  id: string;
  name: string;
  createdAt: string;
  fileCount: number;
}

const MAX_NAME_LENGTH = 60;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  // LEFT JOIN so an empty folder (fileCount 0) still comes back, not just
  // folders that happen to already have a file in them.
  const { results } = await env.DB
    .prepare(
      `SELECT f.id AS id, f.name AS name, f.createdAt AS createdAt, COUNT(m.id) AS fileCount
       FROM media_folders f
       LEFT JOIN media_library m ON m.folderId = f.id AND m.organizationId = f.organizationId
       WHERE f.organizationId = ?
       GROUP BY f.id, f.name, f.createdAt
       ORDER BY f.createdAt ASC`
    )
    .bind(organizationId)
    .all<FolderRow>();

  return jsonResponse({ folders: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return jsonResponse({ error: "Folder name is required" }, 400);
  if (name.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: `Folder name must be ${MAX_NAME_LENGTH} characters or fewer` }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB
    .prepare("INSERT INTO media_folders (id, organizationId, name, createdAt) VALUES (?, ?, ?, ?)")
    .bind(id, organizationId, name, createdAt)
    .run();

  return jsonResponse({ id, name, createdAt, fileCount: 0 });
};
