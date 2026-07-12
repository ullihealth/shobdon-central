// Owner/admin/media-role: GET/PUT /api/tenant/carousel - the 12 carousel
// slots. Assigning a slot to a library file (mediaLibraryId) or a
// webcam (cameraSlotNumber, referencing the existing camera_slots
// table) is metadata-only - no file is touched, moved, or re-uploaded.
// admin was always documented as having media-manager access (see
// src/types/member.ts's original role comment) but was missed when
// this route was actually built - discovered via a real admin-role
// account (test@mail.com) hitting a dead end after login.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CropRectInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CarouselSlotRow {
  slotNumber: number;
  enabled: number;
  mediaType: string;
  durationSeconds: number;
  mediaLibraryId: string | null;
  cameraSlotNumber: number | null;
  fitMode: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  rotationDegrees: number;
  brightnessPercent: number;
  bannerText: string;
  bannerOpacity: number;
  bannerFontSize: string;
}

interface CarouselSlotInput {
  slotNumber: number;
  enabled: boolean;
  mediaType: "image" | "mp4" | "pdf" | "webcam";
  durationSeconds: number;
  mediaLibraryId?: string | null;
  cameraSlotNumber?: number | null;
  fitMode?: "fill" | "contain";
  cropRect?: CropRectInput;
  rotationDegrees?: number;
  brightnessPercent?: number;
  bannerText?: string;
  bannerOpacity?: number;
  bannerFontSize?: "sm" | "md" | "lg";
}

const VALID_MEDIA_TYPES = ["image", "mp4", "pdf", "webcam"];
const VALID_FIT_MODES = ["fill", "contain"];
const VALID_BANNER_SIZES = ["sm", "md", "lg"];

function defaultSlots(): CarouselSlotRow[] {
  return Array.from({ length: 12 }, (_, i) => ({
    slotNumber: i + 1,
    enabled: 0,
    mediaType: "image",
    durationSeconds: 10,
    mediaLibraryId: null,
    cameraSlotNumber: null,
    fitMode: "contain",
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100,
    rotationDegrees: 0,
    brightnessPercent: 100,
    bannerText: "",
    bannerOpacity: 70,
    bannerFontSize: "md",
  }));
}

function rowToApi(row: CarouselSlotRow) {
  return {
    slotNumber: row.slotNumber,
    enabled: !!row.enabled,
    mediaType: row.mediaType,
    durationSeconds: row.durationSeconds,
    mediaLibraryId: row.mediaLibraryId,
    cameraSlotNumber: row.cameraSlotNumber,
    fitMode: row.fitMode,
    cropRect: { x: row.cropX, y: row.cropY, width: row.cropWidth, height: row.cropHeight },
    rotationDegrees: row.rotationDegrees,
    brightnessPercent: row.brightnessPercent,
    bannerText: row.bannerText,
    bannerOpacity: row.bannerOpacity,
    bannerFontSize: row.bannerFontSize,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare(
      `SELECT slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, cameraSlotNumber, fitMode,
              cropX, cropY, cropWidth, cropHeight, rotationDegrees, brightnessPercent,
              bannerText, bannerOpacity, bannerFontSize
       FROM carousel_slots WHERE organizationId = ? ORDER BY slotNumber`
    )
    .bind(organizationId)
    .all<CarouselSlotRow>();

  // Always return a full 12-element array - missing rows (never
  // configured) fill in as disabled defaults, so the frontend doesn't
  // need to reconcile "which of the 12 panels actually has a DB row".
  const bySlot = new Map(results.map((row) => [row.slotNumber, row]));
  const slots = defaultSlots().map((fallback) => bySlot.get(fallback.slotNumber) ?? fallback);

  return jsonResponse({ slots: slots.map(rowToApi) });
};

// Accepts one or more slot updates (the /media-manager UI edits one
// panel at a time) - only the slots included in the body are touched,
// same partial-update convention as tenant/config.ts's runwayGroups/
// cameraSlots handling.
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "media"]);
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
    if (slot.fitMode !== undefined && !VALID_FIT_MODES.includes(slot.fitMode)) {
      return jsonResponse({ error: `fitMode must be one of: ${VALID_FIT_MODES.join(", ")}` }, 400);
    }
    if (slot.cropRect !== undefined) {
      const { x, y, width, height } = slot.cropRect;
      const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
      if (!inRange(x) || !inRange(y) || !inRange(width) || !inRange(height) || width <= 0 || height <= 0) {
        return jsonResponse({ error: "cropRect x/y/width/height must be numbers between 0 and 100, width/height > 0" }, 400);
      }
    }
    if (slot.rotationDegrees !== undefined && (!Number.isFinite(slot.rotationDegrees) || Math.abs(slot.rotationDegrees) > 180)) {
      return jsonResponse({ error: "rotationDegrees must be a number between -180 and 180" }, 400);
    }
    if (slot.brightnessPercent !== undefined && (!Number.isFinite(slot.brightnessPercent) || slot.brightnessPercent < 20 || slot.brightnessPercent > 200)) {
      return jsonResponse({ error: "brightnessPercent must be a number between 20 and 200" }, 400);
    }
    if (slot.bannerOpacity !== undefined && (!Number.isFinite(slot.bannerOpacity) || slot.bannerOpacity < 0 || slot.bannerOpacity > 100)) {
      return jsonResponse({ error: "bannerOpacity must be a number between 0 and 100" }, 400);
    }
    if (slot.bannerFontSize !== undefined && !VALID_BANNER_SIZES.includes(slot.bannerFontSize)) {
      return jsonResponse({ error: `bannerFontSize must be one of: ${VALID_BANNER_SIZES.join(", ")}` }, 400);
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
    const fitMode = slot.fitMode ?? "contain";
    const cropX = slot.cropRect?.x ?? 0;
    const cropY = slot.cropRect?.y ?? 0;
    const cropWidth = slot.cropRect?.width ?? 100;
    const cropHeight = slot.cropRect?.height ?? 100;
    const rotationDegrees = slot.rotationDegrees ?? 0;
    const brightnessPercent = slot.brightnessPercent ?? 100;
    const bannerText = slot.bannerText ?? "";
    const bannerOpacity = slot.bannerOpacity ?? 70;
    const bannerFontSize = slot.bannerFontSize ?? "md";

    await env.DB
      .prepare(
        `INSERT INTO carousel_slots (
           organizationId, slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, cameraSlotNumber,
           fitMode, cropX, cropY, cropWidth, cropHeight, rotationDegrees, brightnessPercent,
           bannerText, bannerOpacity, bannerFontSize, updatedAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organizationId, slotNumber) DO UPDATE SET
           enabled = excluded.enabled,
           mediaType = excluded.mediaType,
           durationSeconds = excluded.durationSeconds,
           mediaLibraryId = excluded.mediaLibraryId,
           cameraSlotNumber = excluded.cameraSlotNumber,
           fitMode = excluded.fitMode,
           cropX = excluded.cropX,
           cropY = excluded.cropY,
           cropWidth = excluded.cropWidth,
           cropHeight = excluded.cropHeight,
           rotationDegrees = excluded.rotationDegrees,
           brightnessPercent = excluded.brightnessPercent,
           bannerText = excluded.bannerText,
           bannerOpacity = excluded.bannerOpacity,
           bannerFontSize = excluded.bannerFontSize,
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
        fitMode,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        rotationDegrees,
        brightnessPercent,
        bannerText,
        bannerOpacity,
        bannerFontSize,
        now
      )
      .run();
  }

  return jsonResponse({ ok: true });
};
