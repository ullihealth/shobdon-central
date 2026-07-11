// Owner/admin/media-role: DELETE /api/tenant/media-library/:id
//
// Deletion protection: before touching R2 or the media_library row,
// check whether any carousel_slots row for this tenant still references
// this file via mediaLibraryId. If so, reject with a clear error naming
// the slot number(s) - the file must be unassigned from every slot
// first. The R2 object is only deleted once nothing references it.
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

  const { results: referencingSlots } = await env.DB
    .prepare("SELECT slotNumber FROM carousel_slots WHERE organizationId = ? AND mediaLibraryId = ?")
    .bind(organizationId, fileId)
    .all<{ slotNumber: number }>();

  if (referencingSlots.length > 0) {
    const slotNumbers = referencingSlots.map((row) => row.slotNumber).sort((a, b) => a - b);
    return jsonResponse(
      {
        error: `This file is still assigned to carousel slot${slotNumbers.length > 1 ? "s" : ""} ${slotNumbers.join(", ")}. Unassign ${slotNumbers.length > 1 ? "those slots" : "that slot"} (pick a different file, disable it, or change its media type) before deleting this file.`,
        slotNumbers,
      },
      409
    );
  }

  await env.MEDIA.delete(file.r2Key);
  await env.DB.prepare("DELETE FROM media_library WHERE id = ? AND organizationId = ?").bind(fileId, organizationId).run();

  return jsonResponse({ ok: true });
};
