// Owner/admin/media-role: DELETE /api/tenant/media-library/:id
//
// Deletion protection: before touching R2 or the media_library row,
// check whether any carousel_slots OR cafe_carousel_slots row for this
// tenant still references this file via mediaLibraryId. If so, reject
// with a clear error naming which slots, in which context (Dashboard/
// Café) - the file must be unassigned from every slot first. The R2
// object is only deleted once nothing references it in EITHER table -
// this is the same referential-integrity check that already existed
// for the dashboard's carousel_slots, extended to also cover café's own
// slot table (migration 0037) so deleting a file still assigned to a
// café slot can no longer silently leave that slot's mediaLibraryId
// pointing at nothing.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

interface R2Bucket {
  delete: (key: string) => Promise<void>;
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

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const fileId = params.id;
  if (!fileId) return jsonResponse({ error: "Missing file id" }, 400);

  const file = await env.DB
    .prepare("SELECT r2Key FROM media_library WHERE id = ? AND organizationId = ?")
    .bind(fileId, organizationId)
    .first<{ r2Key: string }>();
  if (!file) return jsonResponse({ error: "File not found" }, 404);

  const [{ results: dashboardSlots }, { results: cafeSlots }] = await Promise.all([
    env.DB
      .prepare("SELECT slotNumber FROM carousel_slots WHERE organizationId = ? AND mediaLibraryId = ?")
      .bind(organizationId, fileId)
      .all<{ slotNumber: number }>(),
    env.DB
      .prepare("SELECT slotNumber FROM cafe_carousel_slots WHERE organizationId = ? AND mediaLibraryId = ?")
      .bind(organizationId, fileId)
      .all<{ slotNumber: number }>(),
  ]);

  if (dashboardSlots.length > 0 || cafeSlots.length > 0) {
    const describeSlots = (label: string, rows: { slotNumber: number }[]) =>
      rows.length > 0
        ? `${label} slot${rows.length > 1 ? "s" : ""} ${rows
            .map((row) => row.slotNumber)
            .sort((a, b) => a - b)
            .join(", ")}`
        : null;
    const parts = [describeSlots("Dashboard", dashboardSlots), describeSlots("Café", cafeSlots)].filter(
      (part): part is string => part !== null
    );
    return jsonResponse(
      {
        error: `This file is still assigned to ${parts.join(" and ")}. Unassign it (pick a different file, disable the slot, or change its media type) before deleting this file.`,
        dashboardSlotNumbers: dashboardSlots.map((row) => row.slotNumber).sort((a, b) => a - b),
        cafeSlotNumbers: cafeSlots.map((row) => row.slotNumber).sort((a, b) => a - b),
      },
      409
    );
  }

  await env.MEDIA.delete(file.r2Key);
  await env.DB.prepare("DELETE FROM media_library WHERE id = ? AND organizationId = ?").bind(fileId, organizationId).run();

  return jsonResponse({ ok: true });
};

const MAX_FILENAME_LENGTH = 200;
const VALID_USABLE_ON = ["dashboard", "cafe", "both"];
const VALID_ORIENTATIONS = ["16:9", "9:16", "both"];

// Owner/admin/media-role: PATCH /api/tenant/media-library/:id - a small
// partial-update endpoint, covering four independent fields:
//   - folderId: moves the file into a folder (or back to "Uncategorized"
//     via folderId: null).
//   - filename: renames the file's DISPLAY name only.
//   - usableOn / orientation (migration 0037): the Media Library page's
//     retag controls - same "click to change, immediate save" pattern
//     as the existing "Move to folder" dropdown.
// All metadata-only, same as a carousel slot's source assignment -
// neither ever touches r2Key, the R2 object itself, or the row's id.
// That matters specifically for filename: carousel_slots.mediaLibraryId
// and every other reference in this codebase point at the file's id,
// never its filename, so renaming cannot break an existing slot
// assignment, and the file's public URL (built from r2Key) is
// unaffected too.
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const fileId = params.id;
  if (!fileId) return jsonResponse({ error: "Missing file id" }, 400);

  const body = (await request.json().catch(() => null)) as
    | { folderId?: string | null; filename?: string; usableOn?: string; orientation?: string }
    | null;
  if (!body || (!("folderId" in body) && !("filename" in body) && !("usableOn" in body) && !("orientation" in body))) {
    return jsonResponse({ error: "Provide folderId, filename, usableOn, and/or orientation to update" }, 400);
  }
  if ("usableOn" in body && !VALID_USABLE_ON.includes(body.usableOn as string)) {
    return jsonResponse({ error: `usableOn must be one of: ${VALID_USABLE_ON.join(", ")}` }, 400);
  }
  if ("orientation" in body && !VALID_ORIENTATIONS.includes(body.orientation as string)) {
    return jsonResponse({ error: `orientation must be one of: ${VALID_ORIENTATIONS.join(", ")}` }, 400);
  }

  const file = await env.DB
    .prepare("SELECT id FROM media_library WHERE id = ? AND organizationId = ?")
    .bind(fileId, organizationId)
    .first<{ id: string }>();
  if (!file) return jsonResponse({ error: "File not found" }, 404);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if ("folderId" in body) {
    const folderId = body.folderId ?? null;
    if (folderId !== null) {
      // Referential integrity check at the app level, same pattern as
      // carousel/index.ts's mediaLibraryId check - confirm the referenced
      // folder actually belongs to this tenant before linking a file to it.
      const folder = await env.DB
        .prepare("SELECT id FROM media_folders WHERE id = ? AND organizationId = ?")
        .bind(folderId, organizationId)
        .first<{ id: string }>();
      if (!folder) return jsonResponse({ error: `folderId ${folderId} not found in your folders` }, 400);
    }
    setClauses.push("folderId = ?");
    values.push(folderId);
  }

  if ("filename" in body) {
    const filename = body.filename?.trim();
    if (!filename) return jsonResponse({ error: "filename cannot be empty" }, 400);
    if (filename.length > MAX_FILENAME_LENGTH) {
      return jsonResponse({ error: `filename must be ${MAX_FILENAME_LENGTH} characters or fewer` }, 400);
    }
    setClauses.push("filename = ?");
    values.push(filename);
  }

  if ("usableOn" in body) {
    setClauses.push("usableOn = ?");
    values.push(body.usableOn);
  }

  if ("orientation" in body) {
    setClauses.push("orientation = ?");
    values.push(body.orientation);
  }

  values.push(fileId, organizationId);
  await env.DB.prepare(`UPDATE media_library SET ${setClauses.join(", ")} WHERE id = ? AND organizationId = ?`).bind(...values).run();

  return jsonResponse({ ok: true });
};
