// Platform-admin only: POST /api/platform/updates/release - the "select
// a set of reviewed entries and assign them a version number" bulk
// action. Its own dedicated endpoint rather than folded into [id].ts's
// PATCH, since this operates on many rows atomically (one version
// number, one released_at timestamp, applied together) - a single-row
// PATCH can't express "these five entries become v1.6.0 together"
// without risking a half-released version if one row's PATCH succeeded
// and another's didn't.
//
// Only entries currently status = 'reviewed' are eligible - draft
// entries must be marked reviewed first (PATCH .../[id].ts), matching
// the stated draft -> reviewed -> released workflow. Rejects the whole
// batch (no partial release) if any requested id isn't currently
// reviewed, rather than silently skipping it - a release action should
// never leave the caller unsure which entries actually ended up in the
// version they asked for.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

const VERSION_MAX_LENGTH = 40;
const MAX_IDS_PER_RELEASE = 100;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { ids?: unknown; version?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  const version = typeof body.version === "string" ? body.version.trim() : "";

  if (ids.length === 0 || ids.length > MAX_IDS_PER_RELEASE) {
    return jsonResponse({ error: `ids must be a non-empty array of at most ${MAX_IDS_PER_RELEASE} entries` }, 400);
  }
  if (!version || version.length > VERSION_MAX_LENGTH) {
    return jsonResponse({ error: `version is required (max ${VERSION_MAX_LENGTH} chars)` }, 400);
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await env.DB
    .prepare(`SELECT id, status FROM platform_updates WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: string; status: string }>();

  const foundIds = new Set(rows.results.map((row) => row.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return jsonResponse({ error: `Unknown id(s): ${missing.join(", ")}` }, 400);
  }
  const notReviewed = rows.results.filter((row) => row.status !== "reviewed").map((row) => row.id);
  if (notReviewed.length > 0) {
    return jsonResponse({ error: `Only 'reviewed' entries can be released - not currently reviewed: ${notReviewed.join(", ")}` }, 400);
  }

  const now = new Date().toISOString();
  for (const id of ids) {
    await env.DB
      .prepare("UPDATE platform_updates SET status = 'released', version = ?, released_at = ? WHERE id = ?")
      .bind(version, now, id)
      .run();
  }

  return jsonResponse({ ok: true, version, releasedAt: now, count: ids.length });
};
