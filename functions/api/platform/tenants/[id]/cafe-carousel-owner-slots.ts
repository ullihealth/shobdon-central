// Platform-admin only: GET/PUT /api/platform/tenants/:id/cafe-carousel-owner-slots
// - manages slots 5/8/12 of a SPECIFIC tenant's own cafe_carousel_slots
// rows (Café Reserved Owner Slots round, migration 0092). A deliberate
// near-duplicate of the sibling carousel-owner-slots.ts (dashboard's
// carousel_slots table) rather than a shared/parameterized handler -
// same "don't touch the live, production-critical main route as a side
// effect" reasoning functions/api/tenant/cafe-carousel/index.ts's own
// top comment already established for the tenant-facing café/dashboard
// split.
//
// One deliberate difference from carousel-owner-slots.ts: `enabled` is
// caller-controlled here (part of OwnerSlotInput), not hardcoded true.
// The dashboard's version hardcodes enabled=1 because its reserved slots
// are guaranteed always-in-rotation by publicConfig.ts's own synthetic
// "Media Reserved" placeholder injection (tied to that tenant's
// carousel_budget_enabled) - café has no equivalent injection and no
// budget concept (this round is pure reservation, not the Time Budget
// feature), so cafeCarouselSlots' own WHERE enabled = 1 clause is the
// only thing controlling public visibility. Leaving a reserved slot
// disabled keeps it genuinely invisible on the live café screen until a
// developer both unlocks-or-assigns AND explicitly enables it.
//
// Appearance/Duration/Fit Mode/Zone round: this endpoint originally only
// wrote enabled/mediaType/mediaLibraryId/ownerSlotUnlocked (duration
// hardcoded to 10) - every other cafe_carousel_slots column a tenant's
// own editor can set (fitMode, cropRect, rotationDegrees,
// brightnessPercent, bannerText/Opacity/FontSize, zone) was left at its
// schema default with no way to change it here. Validation below
// mirrors functions/api/tenant/cafe-carousel/index.ts's own PUT checks
// for these same fields exactly, since it's the same column set on the
// same table.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

const RESERVED_SLOT_NUMBERS = [5, 8, 12];
const VALID_MEDIA_TYPES = ["image", "mp4", "pdf"];
const VALID_FIT_MODES = ["fill", "contain"];
const VALID_BANNER_SIZES = ["sm", "md", "lg", "xl", "xxl"];
const VALID_ZONES = ["both", "left", "right"];

interface CropRectInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OwnerSlotRow {
  slotNumber: number;
  enabled: number;
  mediaType: string;
  durationSeconds: number;
  mediaLibraryId: string | null;
  ownerSlotUnlocked: number;
  ownerContentAssigned: number;
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
  zone: string;
  r2Key: string | null;
  filename: string | null;
  mp4DurationSeconds: number | null;
}

interface OwnerSlotInput {
  slotNumber: number;
  enabled: boolean;
  mediaType: "image" | "mp4" | "pdf";
  durationSeconds: number;
  mediaLibraryId: string | null;
  ownerSlotUnlocked: boolean;
  fitMode?: "fill" | "contain";
  cropRect?: CropRectInput;
  rotationDegrees?: number;
  brightnessPercent?: number;
  bannerText?: string;
  bannerOpacity?: number;
  bannerFontSize?: "sm" | "md" | "lg" | "xl" | "xxl";
  zone?: "both" | "left" | "right";
}

interface MediaFileRow {
  id: string;
  filename: string;
  mediaType: string;
  mp4DurationSeconds: number | null;
}

async function resolveTenant(db: D1Database, tenantId: number): Promise<{ organizationId: string; slug: string } | null> {
  return db
    .prepare("SELECT organization_id AS organizationId, slug FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ organizationId: string; slug: string }>();
}

async function loadState(db: D1Database, organizationId: string, mediaPublicBaseUrl?: string) {
  const [{ results: slotRows }, { results: fileRows }] = await Promise.all([
    db
      .prepare(
        `SELECT cs.slotNumber AS slotNumber, cs.enabled AS enabled, cs.mediaType AS mediaType, cs.durationSeconds AS durationSeconds,
                cs.mediaLibraryId AS mediaLibraryId, cs.ownerSlotUnlocked AS ownerSlotUnlocked, cs.ownerContentAssigned AS ownerContentAssigned,
                cs.fitMode AS fitMode, cs.cropX AS cropX, cs.cropY AS cropY, cs.cropWidth AS cropWidth, cs.cropHeight AS cropHeight,
                cs.rotationDegrees AS rotationDegrees, cs.brightnessPercent AS brightnessPercent,
                cs.bannerText AS bannerText, cs.bannerOpacity AS bannerOpacity, cs.bannerFontSize AS bannerFontSize, cs.zone AS zone,
                ml.r2Key AS r2Key, ml.filename AS filename, ml.mp4DurationSeconds AS mp4DurationSeconds
         FROM cafe_carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         WHERE cs.organizationId = ? AND cs.slotNumber IN (5, 8, 12)`
      )
      .bind(organizationId)
      .all<OwnerSlotRow>(),
    db
      .prepare("SELECT id, filename, mediaType, mp4DurationSeconds FROM media_library WHERE organizationId = ? ORDER BY uploadedAt DESC")
      .bind(organizationId)
      .all<MediaFileRow>(),
  ]);

  const bySlot = new Map(slotRows.map((row) => [row.slotNumber, row]));
  const slots = RESERVED_SLOT_NUMBERS.map((slotNumber) => {
    const row = bySlot.get(slotNumber);
    return {
      slotNumber,
      enabled: !!row?.enabled,
      mediaType: row?.mediaType ?? "image",
      durationSeconds: row?.durationSeconds ?? 10,
      mediaLibraryId: row?.mediaLibraryId ?? null,
      ownerSlotUnlocked: !!row?.ownerSlotUnlocked,
      ownerContentAssigned: !!row?.ownerContentAssigned,
      fitMode: row?.fitMode ?? "contain",
      cropRect: { x: row?.cropX ?? 0, y: row?.cropY ?? 0, width: row?.cropWidth ?? 100, height: row?.cropHeight ?? 100 },
      rotationDegrees: row?.rotationDegrees ?? 0,
      brightnessPercent: row?.brightnessPercent ?? 100,
      bannerText: row?.bannerText ?? "",
      bannerOpacity: row?.bannerOpacity ?? 70,
      bannerFontSize: row?.bannerFontSize ?? "md",
      zone: row?.zone ?? "both",
      filename: row?.filename ?? null,
      resolvedUrl: row?.r2Key && mediaPublicBaseUrl ? `${mediaPublicBaseUrl}/${row.r2Key}` : null,
      mp4DurationSeconds: row?.mp4DurationSeconds ?? null,
    };
  });

  return { slots, files: fileRows };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await resolveTenant(env.DB, tenantId);
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);

  return jsonResponse(await loadState(env.DB, tenant.organizationId, env.MEDIA_PUBLIC_BASE_URL));
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await resolveTenant(env.DB, tenantId);
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);
  const { organizationId } = tenant;

  const body = (await request.json().catch(() => null)) as { slots?: OwnerSlotInput[] } | null;
  if (!body || !Array.isArray(body.slots)) return jsonResponse({ error: "Invalid JSON body" }, 400);

  for (const slot of body.slots) {
    if (!RESERVED_SLOT_NUMBERS.includes(slot.slotNumber)) {
      return jsonResponse({ error: `slotNumber must be one of: ${RESERVED_SLOT_NUMBERS.join(", ")}` }, 400);
    }
    if (!VALID_MEDIA_TYPES.includes(slot.mediaType)) {
      return jsonResponse({ error: `mediaType must be one of: ${VALID_MEDIA_TYPES.join(", ")}` }, 400);
    }
    if (typeof slot.enabled !== "boolean") {
      return jsonResponse({ error: "enabled must be a boolean" }, 400);
    }
    if (typeof slot.ownerSlotUnlocked !== "boolean") {
      return jsonResponse({ error: "ownerSlotUnlocked must be a boolean" }, 400);
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
    if (slot.zone !== undefined && !VALID_ZONES.includes(slot.zone)) {
      return jsonResponse({ error: `zone must be one of: ${VALID_ZONES.join(", ")}` }, 400);
    }
    if (slot.mediaLibraryId) {
      const file = await env.DB
        .prepare("SELECT id FROM media_library WHERE id = ? AND organizationId = ?")
        .bind(slot.mediaLibraryId, organizationId)
        .first<{ id: string }>();
      if (!file) return jsonResponse({ error: `mediaLibraryId ${slot.mediaLibraryId} not found in this tenant's media library` }, 400);
    }
  }

  const now = new Date().toISOString();
  for (const slot of body.slots) {
    const mediaLibraryId = slot.mediaLibraryId ?? null;
    const ownerContentAssigned = mediaLibraryId ? 1 : 0;
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
    const zone = slot.zone ?? "both";

    await env.DB
      .prepare(
        `INSERT INTO cafe_carousel_slots (
           organizationId, slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, ownerSlotUnlocked, ownerContentAssigned,
           fitMode, cropX, cropY, cropWidth, cropHeight, rotationDegrees, brightnessPercent,
           bannerText, bannerOpacity, bannerFontSize, zone, updatedAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organizationId, slotNumber) DO UPDATE SET
           enabled = excluded.enabled,
           mediaType = excluded.mediaType,
           durationSeconds = excluded.durationSeconds,
           mediaLibraryId = excluded.mediaLibraryId,
           ownerSlotUnlocked = excluded.ownerSlotUnlocked,
           ownerContentAssigned = excluded.ownerContentAssigned,
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
           zone = excluded.zone,
           updatedAt = excluded.updatedAt`
      )
      .bind(
        organizationId,
        slot.slotNumber,
        slot.enabled ? 1 : 0,
        slot.mediaType,
        slot.durationSeconds,
        mediaLibraryId,
        slot.ownerSlotUnlocked ? 1 : 0,
        ownerContentAssigned,
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
        zone,
        now
      )
      .run();
  }

  return jsonResponse(await loadState(env.DB, organizationId, env.MEDIA_PUBLIC_BASE_URL));
};
