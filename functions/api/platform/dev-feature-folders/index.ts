// Platform-admin only: GET/POST /api/platform/dev-feature-folders - the
// flat folder list Developer Features entries can optionally belong to
// (dev_features.folder_id, one-to-one - see migration 0067's own
// comment on why this is deliberately not many-to-many).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

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
}

const NAME_MAX_LENGTH = 100;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const { results } = await env.DB
    .prepare("SELECT id, name, created_at AS createdAt FROM dev_feature_folders ORDER BY name")
    .all<FolderRow>();

  return jsonResponse({ folders: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > NAME_MAX_LENGTH) {
    return jsonResponse({ error: `name is required (max ${NAME_MAX_LENGTH} chars)` }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO dev_feature_folders (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, now).run();

  return jsonResponse({ id, name, createdAt: now });
};
