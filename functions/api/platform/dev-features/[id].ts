// Platform-admin only: PATCH /api/platform/dev-features/:id - edit
// status/notes/folder on any entry, or title/description on a
// developer-private one only (linked entries read those two fields
// through from feature_requests - see index.ts's own comment - so
// editing them here is rejected, not silently ignored).
//
// Completion -> Updates linkage: when this write is the entry's FIRST
// ever transition into status='built' (guarded on completedAt being
// NULL, not on current.status !== 'built' - see below for why that
// distinction matters), a new platform_updates draft is inserted as a
// side effect of this same request, title/description copied ONE TIME
// from whichever source applies. This is a one-way INSERT only - never
// an UPDATE of an existing platform_updates row - so there's no
// circular sync between this table and that one.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CurrentRow {
  linkedFeatureRequestId: string | null;
  title: string | null;
  description: string | null;
  status: string;
  notes: string | null;
  folderId: string | null;
  completedAt: string | null;
}

interface LinkedFeatureRequestRow {
  title: string;
  description: string;
}

const STATUSES = ["idea", "planned", "built", "parked"] as const;
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const id = params.id;
  const body = (await request.json().catch(() => null)) as
    | { title?: unknown; description?: unknown; status?: unknown; notes?: unknown; folderId?: unknown }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const fields = ["title", "description", "status", "notes", "folderId"] as const;
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
  if (body.status !== undefined && !STATUSES.includes(body.status as (typeof STATUSES)[number])) {
    return jsonResponse({ error: `status must be one of: ${STATUSES.join(", ")}` }, 400);
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    return jsonResponse({ error: "notes must be a string or null" }, 400);
  }
  if (body.folderId !== undefined && body.folderId !== null && typeof body.folderId !== "string") {
    return jsonResponse({ error: "folderId must be a string or null" }, 400);
  }

  const current = await env.DB
    .prepare(
      `SELECT linked_feature_request_id AS linkedFeatureRequestId, title, description, status, notes,
              folder_id AS folderId, completed_at AS completedAt
       FROM dev_features WHERE id = ?`
    )
    .bind(id)
    .first<CurrentRow>();
  if (!current) return jsonResponse({ error: "Entry not found" }, 404);

  if ((body.title !== undefined || body.description !== undefined) && current.linkedFeatureRequestId !== null) {
    return jsonResponse({ error: "title/description are read through from the linked feature request and can't be edited here" }, 400);
  }

  if (body.folderId) {
    const folder = await env.DB.prepare("SELECT id FROM dev_feature_folders WHERE id = ?").bind(body.folderId).first<{ id: string }>();
    if (!folder) return jsonResponse({ error: "Unknown folderId" }, 400);
  }

  const now = new Date().toISOString();
  const next = {
    title: (body.title as string | undefined)?.trim() ?? current.title,
    description: (body.description as string | undefined)?.trim() ?? current.description,
    status: (body.status as string | undefined) ?? current.status,
    notes: body.notes !== undefined ? (body.notes as string | null) : current.notes,
    folderId: body.folderId !== undefined ? (body.folderId as string | null) : current.folderId,
  };

  // Guarded on completedAt being NULL, deliberately NOT on
  // `current.status !== 'built'` alone - the latter would re-fire (and
  // create a second draft) every time an entry is toggled away from and
  // back to 'built', which this round's own verification checklist
  // explicitly requires NOT to happen. completedAt already exists in
  // the approved schema as an audit field; keying the one-time-only
  // guard off it (set once, on the first-ever completion, left
  // untouched by every status change after that) satisfies both "fires
  // on genuine completion" and "no duplicate on away-and-back" with no
  // extra column beyond what was already planned.
  const isFirstCompletion = current.completedAt === null && next.status === "built";
  const completedAt = isFirstCompletion ? now : current.completedAt;

  await env.DB
    .prepare(
      `UPDATE dev_features SET title = ?, description = ?, status = ?, notes = ?, folder_id = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(next.title, next.description, next.status, next.notes, next.folderId, completedAt, now, id)
    .run();

  let createdUpdateId: string | null = null;
  if (isFirstCompletion) {
    let sourceTitle = next.title;
    let sourceDescription = next.description;
    if (current.linkedFeatureRequestId) {
      const linked = await env.DB
        .prepare("SELECT title, description FROM feature_requests WHERE id = ?")
        .bind(current.linkedFeatureRequestId)
        .first<LinkedFeatureRequestRow>();
      if (linked) {
        sourceTitle = linked.title;
        sourceDescription = linked.description;
      }
    }
    createdUpdateId = crypto.randomUUID();
    await env.DB
      .prepare(
        `INSERT INTO platform_updates (id, title, description, status, version, created_at, released_at, source_dev_feature_id)
         VALUES (?, ?, ?, 'draft', NULL, ?, NULL, ?)`
      )
      .bind(createdUpdateId, sourceTitle, sourceDescription, now, id)
      .run();
  }

  return jsonResponse({ id, ...next, completedAt, createdUpdateId });
};
