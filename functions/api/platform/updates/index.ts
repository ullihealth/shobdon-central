// Platform-admin only: GET/POST /api/platform/updates - the internal,
// app-wide "Developer Updates" running changelog (migration 0050),
// deliberately NOT tenant-facing (no tenant_id on the table at all, no
// tenant-scoped auth here). Same requirePlatformAdmin gating as every
// other /platform/* route.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface UpdateRow {
  id: string;
  title: string;
  description: string;
  status: string;
  version: string | null;
  createdAt: string;
  releasedAt: string | null;
}

const DESCRIPTION_MAX_LENGTH = 2000;
const TITLE_MAX_LENGTH = 200;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  // Ordering: draft/reviewed entries newest-first (that's the "pending"
  // queue, most recent work at the top); released entries grouped by
  // version, newest version first, oldest-created-within-a-version
  // first (a natural reading order within each release). Done as one
  // ORDER BY rather than two separate queries - PlatformUpdatesPage.tsx
  // itself splits the single result set into pending/released sections
  // client-side (status !== 'released' vs. status === 'released'), same
  // "one fetch, split client-side" shape as DisplayUrlList.tsx's own
  // displays list.
  const rows = await env.DB
    .prepare(
      `SELECT id, title, description, status, version, created_at AS createdAt, released_at AS releasedAt
       FROM platform_updates
       ORDER BY
         CASE WHEN status = 'released' THEN 1 ELSE 0 END,
         version DESC,
         created_at DESC`
    )
    .all<UpdateRow>();

  return jsonResponse({ updates: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { title?: unknown; description?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!title || title.length > TITLE_MAX_LENGTH) {
    return jsonResponse({ error: `title is required (max ${TITLE_MAX_LENGTH} chars)` }, 400);
  }
  if (!description || description.length > DESCRIPTION_MAX_LENGTH) {
    return jsonResponse({ error: `description is required (max ${DESCRIPTION_MAX_LENGTH} chars)` }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at)
       VALUES (?, ?, ?, 'draft', NULL, ?, NULL)`
    )
    .bind(id, title, description, now)
    .run();

  return jsonResponse({ ok: true, id, status: "draft", createdAt: now });
};
