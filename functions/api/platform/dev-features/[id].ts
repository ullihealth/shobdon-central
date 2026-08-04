// Platform-admin only: PATCH /api/platform/dev-features/:id - edit
// notes/folder/eligibleForRelease on any entry, title/description on a
// developer-private one only (linked entries read those two fields
// through from feature_requests - see index.ts's own comment - so
// editing them here is rejected, not silently ignored), or fire the
// one-way "Complete" action.
//
// Dev-features/Updates consolidation round: the old status field
// ('idea'/'planned'/'built'/'parked') and the completion side effect
// that used to live here (auto-creating a platform_updates draft the
// moment status became 'built') are BOTH gone. completed: true now just
// sets completedAt, full stop - no platform_updates row is created
// until an actual release (functions/api/platform/updates/release.ts),
// which operates on whichever entries are sitting in the REVIEWED tab
// (completedAt set, eligibleForRelease true, releasedUpdateId still
// null - computed by the frontend from these same three fields, not a
// stored tab/stage column of its own).
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
  notes: string | null;
  folderId: string | null;
  completedAt: string | null;
  eligibleForRelease: number;
  releasedUpdateId: string | null;
}

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const id = params.id;
  const body = (await request.json().catch(() => null)) as
    | { title?: unknown; description?: unknown; notes?: unknown; folderId?: unknown; eligibleForRelease?: unknown; completed?: unknown }
    | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const fields = ["title", "description", "notes", "folderId", "eligibleForRelease", "completed"] as const;
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
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== "string") {
    return jsonResponse({ error: "notes must be a string or null" }, 400);
  }
  if (body.folderId !== undefined && body.folderId !== null && typeof body.folderId !== "string") {
    return jsonResponse({ error: "folderId must be a string or null" }, 400);
  }
  if (body.eligibleForRelease !== undefined && typeof body.eligibleForRelease !== "boolean") {
    return jsonResponse({ error: "eligibleForRelease must be a boolean" }, 400);
  }
  if (body.completed !== undefined && body.completed !== true) {
    return jsonResponse({ error: "completed, if provided, must be true - there's no way to un-complete an entry" }, 400);
  }

  const current = await env.DB
    .prepare(
      `SELECT linked_feature_request_id AS linkedFeatureRequestId, title, description, notes,
              folder_id AS folderId, completed_at AS completedAt, eligible_for_release AS eligibleForRelease,
              released_update_id AS releasedUpdateId
       FROM dev_features WHERE id = ?`
    )
    .bind(id)
    .first<CurrentRow>();
  if (!current) return jsonResponse({ error: "Entry not found" }, 404);

  if (current.releasedUpdateId) {
    return jsonResponse({ error: "This entry has already been released and is part of the permanent record - it can no longer be edited" }, 400);
  }
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
    notes: body.notes !== undefined ? (body.notes as string | null) : current.notes,
    folderId: body.folderId !== undefined ? (body.folderId as string | null) : current.folderId,
    eligibleForRelease: body.eligibleForRelease !== undefined ? (body.eligibleForRelease as boolean) : !!current.eligibleForRelease,
    // Idempotent - completed: true on an already-completed entry just
    // keeps the original timestamp rather than bumping it, since
    // "Complete" is meant to be a one-time transition, not a repeatable
    // touch.
    completedAt: body.completed === true ? current.completedAt ?? now : current.completedAt,
  };

  await env.DB
    .prepare(
      `UPDATE dev_features SET title = ?, description = ?, notes = ?, folder_id = ?, eligible_for_release = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(next.title, next.description, next.notes, next.folderId, next.eligibleForRelease ? 1 : 0, next.completedAt, now, id)
    .run();

  return jsonResponse({ id, ...next });
};
