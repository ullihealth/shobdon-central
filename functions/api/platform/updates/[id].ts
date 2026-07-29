// Platform-admin only: PATCH /api/platform/updates/:id - edit an
// entry's title/description, or move it draft <-> reviewed. Same
// "fetch current row, merge only the fields present in the body, write
// everything back" shape as platform/tenants/[id].ts's own PATCH.
//
// Deliberately does NOT accept status: 'released' here - releasing
// requires a version number assigned atomically across a whole batch
// of entries (see release.ts), not a single-row status flip that would
// leave version/released_at inconsistent. Un-releasing (released ->
// reviewed/draft) is also not supported here - once a version is
// live, its entries are the permanent record; if that ever needs to
// change, it's a deliberate follow-up, not a side effect of this
// generic edit endpoint.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface UpdateRow {
  title: string;
  description: string;
  status: string;
  version: string | null;
  releasedAt: string | null;
}

const DESCRIPTION_MAX_LENGTH = 2000;
const TITLE_MAX_LENGTH = 200;
const EDITABLE_STATUSES = ["draft", "reviewed"];

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as
    | { title?: unknown; description?: unknown; status?: unknown }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const fields = ["title", "description", "status"] as const;
  if (!fields.some((field) => body[field] !== undefined)) {
    return jsonResponse({ error: `Provide at least one of: ${fields.join(", ")}` }, 400);
  }
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > TITLE_MAX_LENGTH)) {
    return jsonResponse({ error: `title must be a non-empty string (max ${TITLE_MAX_LENGTH} chars)` }, 400);
  }
  if (
    body.description !== undefined &&
    (typeof body.description !== "string" || !body.description.trim() || body.description.length > DESCRIPTION_MAX_LENGTH)
  ) {
    return jsonResponse({ error: `description must be a non-empty string (max ${DESCRIPTION_MAX_LENGTH} chars)` }, 400);
  }
  if (body.status !== undefined && !EDITABLE_STATUSES.includes(body.status as string)) {
    return jsonResponse({ error: `status must be one of: ${EDITABLE_STATUSES.join(", ")} (use /release to mark released)` }, 400);
  }

  const current = await env.DB
    .prepare("SELECT title, description, status, version, released_at AS releasedAt FROM platform_updates WHERE id = ?")
    .bind(params.id)
    .first<UpdateRow>();
  if (!current) return jsonResponse({ error: "Update not found" }, 404);
  if (current.status === "released") {
    return jsonResponse({ error: "This entry has already been released and is part of the permanent record - it can no longer be edited" }, 400);
  }

  const next = {
    title: (body.title as string | undefined)?.trim() ?? current.title,
    description: (body.description as string | undefined)?.trim() ?? current.description,
    status: (body.status as string | undefined) ?? current.status,
  };

  await env.DB
    .prepare("UPDATE platform_updates SET title = ?, description = ?, status = ? WHERE id = ?")
    .bind(next.title, next.description, next.status, params.id)
    .run();

  return jsonResponse({ ok: true, ...next });
};
