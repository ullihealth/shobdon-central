// Platform-admin only: GET/PUT /api/platform/tenants/:id/cafe-carousel-owner-slots
// - manages a SPECIFIC tenant's own cafe_carousel_slots rows (Café
// Reserved Owner Slots round, migration 0092). A deliberate
// near-duplicate of the sibling carousel-owner-slots.ts (dashboard's
// carousel_slots table) rather than a shared/parameterized handler -
// same "don't touch the live, production-critical main route as a side
// effect" reasoning functions/api/tenant/cafe-carousel/index.ts's own
// top comment already established for the tenant-facing café/dashboard
// split.
//
// Per-tenant Reserved Slot round (migration 0102) - originally this
// endpoint only ever managed the fixed [5, 8, 12] list (same
// RESERVED_SLOT_NUMBERS constant tenant/cafe-carousel/index.ts used to
// have), both in its own SQL WHERE clause and its PUT validation -
// confirmed via investigation neither was just a frontend restriction.
// Now returns/accepts any of a tenant's 12 slots, keyed off that same
// row's own ownerSlotReserved column instead of a hardcoded list -
// PlatformCafeCarouselOwnerSlotsPage.tsx's slot-number selector is what
// lets an admin actually reach a non-5/8/12 slot now.
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
// developer both reserves-or-assigns AND explicitly enables it.
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

// Fallback only for a slot that has literally never had a row written -
// see functions/api/tenant/cafe-carousel/index.ts's own
// LEGACY_DEFAULT_RESERVED_SLOTS comment for the full reasoning; not a
// real case for any tenant today (migration 0102's backfill covers
// every existing 5/8/12 row).
const LEGACY_DEFAULT_RESERVED_SLOTS = [5, 8, 12];
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
  ownerSlotReserved: number;
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
  ownerSlotReserved: boolean;
  // Only required/used when ownerSlotReserved is true - switching a
  // slot to Tenant-controlled needs nothing else at all (see the PUT
  // handler's own early-continue for that case).
  enabled?: boolean;
  mediaType?: "image" | "mp4" | "pdf";
  durationSeconds?: number;
  mediaLibraryId?: string | null;
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
                cs.mediaLibraryId AS mediaLibraryId, cs.ownerSlotReserved AS ownerSlotReserved, cs.ownerContentAssigned AS ownerContentAssigned,
                cs.fitMode AS fitMode, cs.cropX AS cropX, cs.cropY AS cropY, cs.cropWidth AS cropWidth, cs.cropHeight AS cropHeight,
                cs.rotationDegrees AS rotationDegrees, cs.brightnessPercent AS brightnessPercent,
                cs.bannerText AS bannerText, cs.bannerOpacity AS bannerOpacity, cs.bannerFontSize AS bannerFontSize, cs.zone AS zone,
                ml.r2Key AS r2Key, ml.filename AS filename, ml.mp4DurationSeconds AS mp4DurationSeconds
         FROM cafe_carousel_slots cs
         LEFT JOIN media_library ml ON ml.id = cs.mediaLibraryId
         WHERE cs.organizationId = ?`
      )
      .bind(organizationId)
      .all<OwnerSlotRow>(),
    db
      .prepare("SELECT id, filename, mediaType, mp4DurationSeconds FROM media_library WHERE organizationId = ? ORDER BY uploadedAt DESC")
      .bind(organizationId)
      .all<MediaFileRow>(),
  ]);

  // All 12 slots now (not just the old fixed 3) - the slot-number
  // selector on PlatformCafeCarouselOwnerSlotsPage.tsx needs every
  // slot's own ownerSlotReserved state to render its "Reserved: ..."
  // summary and let an admin pick any of them, not just three.
  const bySlot = new Map(slotRows.map((row) => [row.slotNumber, row]));
  const slots = Array.from({ length: 12 }, (_, i) => i + 1).map((slotNumber) => {
    const row = bySlot.get(slotNumber);
    return {
      slotNumber,
      enabled: !!row?.enabled,
      mediaType: row?.mediaType ?? "image",
      durationSeconds: row?.durationSeconds ?? 10,
      mediaLibraryId: row?.mediaLibraryId ?? null,
      ownerSlotReserved: row ? !!row.ownerSlotReserved : LEGACY_DEFAULT_RESERVED_SLOTS.includes(slotNumber),
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
    if (!Number.isInteger(slot.slotNumber) || slot.slotNumber < 1 || slot.slotNumber > 12) {
      return jsonResponse({ error: `slotNumber must be 1-12 (got ${slot.slotNumber})` }, 400);
    }
    if (typeof slot.ownerSlotReserved !== "boolean") {
      return jsonResponse({ error: "ownerSlotReserved must be a boolean" }, 400);
    }
    // Switching to Tenant-controlled needs nothing else - the write
    // below clears any AC content/config for this slot outright, so
    // none of the content fields below are read in that case at all.
    if (!slot.ownerSlotReserved) continue;
    if (!slot.mediaType || !VALID_MEDIA_TYPES.includes(slot.mediaType)) {
      return jsonResponse({ error: `mediaType must be one of: ${VALID_MEDIA_TYPES.join(", ")}` }, 400);
    }
    if (typeof slot.enabled !== "boolean") {
      return jsonResponse({ error: "enabled must be a boolean" }, 400);
    }
    if (!Number.isFinite(slot.durationSeconds) || (slot.durationSeconds as number) <= 0) {
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
    if (!slot.ownerSlotReserved) {
      // Tenant-controlled round-trip: un-reserve and hand the slot back
      // in a clean state - clears any AC-assigned content/masking
      // outright (not just an inert flip) so the tenant's own editor
      // never inherits stale AC config when they regain control. A
      // plain UPDATE (not upsert) is enough - every tenant that could
      // reach this slot via the picker already has a real row for it
      // (either from a prior save, or from migration 0102's own
      // backfill for 5/8/12), so there's nothing to create here.
      await env.DB
        .prepare(
          `UPDATE cafe_carousel_slots
           SET ownerSlotReserved = 0, ownerSlotUnlocked = 0, mediaLibraryId = NULL, ownerContentAssigned = 0, enabled = 0, updatedAt = ?
           WHERE organizationId = ? AND slotNumber = ?`
        )
        .bind(now, organizationId, slot.slotNumber)
        .run();
      continue;
    }

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
           organizationId, slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, ownerSlotUnlocked, ownerSlotReserved, ownerContentAssigned,
           fitMode, cropX, cropY, cropWidth, cropHeight, rotationDegrees, brightnessPercent,
           bannerText, bannerOpacity, bannerFontSize, zone, updatedAt
         )
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organizationId, slotNumber) DO UPDATE SET
           enabled = excluded.enabled,
           mediaType = excluded.mediaType,
           durationSeconds = excluded.durationSeconds,
           mediaLibraryId = excluded.mediaLibraryId,
           ownerSlotUnlocked = excluded.ownerSlotUnlocked,
           ownerSlotReserved = excluded.ownerSlotReserved,
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
