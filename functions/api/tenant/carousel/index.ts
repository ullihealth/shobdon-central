// Owner/media-role: GET/PUT /api/tenant/carousel - the 12 carousel
// slots. Assigning a slot to a library file (mediaLibraryId) or a
// webcam (cameraSlotNumber, referencing the existing camera_slots
// table) is metadata-only - no file is touched, moved, or re-uploaded.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CarouselSlotRow {
  slotNumber: number;
  enabled: number;
  mediaType: string;
  durationSeconds: number;
  mediaLibraryId: string | null;
  cameraSlotNumber: number | null;
}

interface CarouselSlotInput {
  slotNumber: number;
  enabled: boolean;
  mediaType: "image" | "mp4" | "pdf" | "webcam";
  durationSeconds: number;
  mediaLibraryId?: string | null;
  cameraSlotNumber?: number | null;
}

const VALID_MEDIA_TYPES = ["image", "mp4", "pdf", "webcam"];

function defaultSlots(): CarouselSlotRow[] {
  return Array.from({ length: 12 }, (_, i) => ({
    slotNumber: i + 1,
    enabled: 0,
    mediaType: "image",
    durationSeconds: 10,
    mediaLibraryId: null,
    cameraSlotNumber: null,
  }));
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare(
      "SELECT slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, cameraSlotNumber FROM carousel_slots WHERE organizationId = ? ORDER BY slotNumber"
    )
    .bind(organizationId)
    .all<CarouselSlotRow>();

  // Always return a full 12-element array - missing rows (never
  // configured) fill in as disabled defaults, so the frontend doesn't
  // need to reconcile "which of the 12 panels actually has a DB row".
  const bySlot = new Map(results.map((row) => [row.slotNumber, row]));
  const slots = defaultSlots().map((fallback) => bySlot.get(fallback.slotNumber) ?? fallback);

  return jsonResponse({
    slots: slots.map((row) => ({
      slotNumber: row.slotNumber,
      enabled: !!row.enabled,
      mediaType: row.mediaType,
      durationSeconds: row.durationSeconds,
      mediaLibraryId: row.mediaLibraryId,
      cameraSlotNumber: row.cameraSlotNumber,
    })),
  });
};

// Accepts one or more slot updates (the /media-manager UI edits one
// panel at a time) - only the slots included in the body are touched,
// same partial-update convention as tenant/config.ts's runwayGroups/
// cameraSlots handling.
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { slots?: CarouselSlotInput[] } | null;
  if (!body || !Array.isArray(body.slots)) return jsonResponse({ error: "Invalid JSON body" }, 400);

  for (const slot of body.slots) {
    if (!Number.isInteger(slot.slotNumber) || slot.slotNumber < 1 || slot.slotNumber > 12) {
      return jsonResponse({ error: `slotNumber must be 1-12 (got ${slot.slotNumber})` }, 400);
    }
    if (!VALID_MEDIA_TYPES.includes(slot.mediaType)) {
      return jsonResponse({ error: `mediaType must be one of: ${VALID_MEDIA_TYPES.join(", ")}` }, 400);
    }
    if (!Number.isFinite(slot.durationSeconds) || slot.durationSeconds <= 0) {
      return jsonResponse({ error: "durationSeconds must be a positive number" }, 400);
    }

    if (slot.mediaType === "webcam") {
      if (!slot.cameraSlotNumber || slot.cameraSlotNumber < 1 || slot.cameraSlotNumber > 3) {
        return jsonResponse({ error: "cameraSlotNumber must be 1-3 when mediaType is webcam" }, 400);
      }
    } else if (slot.mediaLibraryId) {
      // Referential integrity check at the app level - confirm the
      // referenced file actually belongs to this tenant before linking
      // a slot to it.
      const file = await env.DB
        .prepare("SELECT id FROM media_library WHERE id = ? AND organizationId = ?")
        .bind(slot.mediaLibraryId, organizationId)
        .first<{ id: string }>();
      if (!file) return jsonResponse({ error: `mediaLibraryId ${slot.mediaLibraryId} not found in your media library` }, 400);
    }
  }

  const now = new Date().toISOString();
  for (const slot of body.slots) {
    // mediaLibraryId and cameraSlotNumber are mutually exclusive by
    // mediaType - explicitly null out whichever doesn't apply, rather
    // than trusting the client not to send stale values for the other.
    const mediaLibraryId = slot.mediaType === "webcam" ? null : slot.mediaLibraryId ?? null;
    const cameraSlotNumber = slot.mediaType === "webcam" ? slot.cameraSlotNumber ?? null : null;

    await env.DB
      .prepare(
        `INSERT INTO carousel_slots (organizationId, slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, cameraSlotNumber, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organizationId, slotNumber) DO UPDATE SET
           enabled = excluded.enabled,
           mediaType = excluded.mediaType,
           durationSeconds = excluded.durationSeconds,
           mediaLibraryId = excluded.mediaLibraryId,
           cameraSlotNumber = excluded.cameraSlotNumber,
           updatedAt = excluded.updatedAt`
      )
      .bind(
        organizationId,
        slot.slotNumber,
        slot.enabled ? 1 : 0,
        slot.mediaType,
        slot.durationSeconds,
        mediaLibraryId,
        cameraSlotNumber,
        now
      )
      .run();
  }

  return jsonResponse({ ok: true });
};
