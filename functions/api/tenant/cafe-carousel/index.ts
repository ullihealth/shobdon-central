// Owner/admin: GET/PUT /api/tenant/cafe-carousel - the café screen's own
// 12 carousel slots (migration 0037, cafe_carousel_slots table). A
// deliberate near-duplicate of ../carousel/index.ts (the dashboard's
// carousel_slots table/route) rather than a shared/parameterized
// handler - the dashboard route is live, production-critical code
// serving the real public dashboard right now, and this file existing
// standalone means nothing about that route's behaviour changes as a
// side effect of adding café's own version. Role gate is owner/admin
// only (no 'media' role), matching every other /api/tenant/cafe-*
// route and Cafe Media's own page-level access - unlike the dashboard
// carousel route, which does include 'media' (a pre-existing,
// deliberately unchanged access boundary, not something this file
// should quietly widen).
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { resolveTenantSlug, triggerTenantRefresh } from "../../_utils/refreshDisplays";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  // Tenant-triggered refresh round - a tenant saving their own café
  // carousel should never need a separate manual "refresh my display"
  // action (see _utils/refreshDisplays.ts's own comment for the
  // CAPTURE_KEY shape).
  CAPTURE_KEY?: string;
}

interface CropRectInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CafeCarouselSlotRow {
  slotNumber: number;
  enabled: number;
  mediaType: string;
  durationSeconds: number;
  mediaLibraryId: string | null;
  cameraSlotNumber: number | null;
  cameraId: string | null;
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
  autoFullscreen: number;
  ownerSlotUnlocked: number;
  ownerSlotReserved: number;
  externalUrl: string | null;
  websiteFixedCanvas: number;
  durationCapOverrideSeconds: number | null;
}

// Per-slot duration cap round (migration 0103) - the tenant-facing
// Duration (seconds) input (image/pdf/webcam/gyropedia/website only -
// mp4 is read-only/auto-detected, no manual field to cap) is limited to
// this many seconds by default; durationCapOverrideSeconds overrides it
// per-slot, developer-set only via the platform-admin owner-slots tool.
// Enforced here as a server-side safety net (silent clamp, not a
// rejection) - CarouselSlotEditor.tsx's own `max` attribute is the real,
// user-facing boundary; this just makes sure a direct API call can't
// bypass it.
const DEFAULT_DURATION_CAP_SECONDS = 20;

// Per-tenant Reserved Slot round (migration 0102) - ownerSlotReserved is
// now the source of truth for "is this specific slot number reserved
// for THIS tenant", replacing the old hardcoded RESERVED_SLOT_NUMBERS =
// [5, 8, 12] list (every tenant used to share the same 3 numbers,
// enforced here and in the platform-admin owner-slots route). Managed
// via functions/api/platform/tenants/[id]/cafe-carousel-owner-slots.ts.
//
// LEGACY_DEFAULT_RESERVED_SLOTS is only a fallback for a slot that has
// literally never had a row written at all - migration 0102's own
// backfill already set ownerSlotReserved=1 on every existing tenant's
// real 5/8/12 rows (confirmed both Meg's Cafe and the org_newcustomer
// template already have those rows), so this only matters for a
// hypothetical tenant that somehow never touched Café Media before this
// feature existed - not a real case today, but keeps "absence of a row
// still reads as reserved" exactly the behaviour it always was.
const LEGACY_DEFAULT_RESERVED_SLOTS = [5, 8, 12];

interface CafeCarouselSlotInput {
  slotNumber: number;
  enabled: boolean;
  mediaType: "image" | "mp4" | "pdf" | "webcam" | "gyropedia" | "website";
  durationSeconds: number;
  mediaLibraryId?: string | null;
  cameraSlotNumber?: number | null;
  cameraId?: string | null;
  fitMode?: "fill" | "contain";
  cropRect?: CropRectInput;
  rotationDegrees?: number;
  brightnessPercent?: number;
  bannerText?: string;
  bannerOpacity?: number;
  bannerFontSize?: "sm" | "md" | "lg" | "xl" | "xxl";
  zone?: "both" | "left" | "right";
  autoFullscreen?: boolean;
  // Café "Website" slot type (migration 0093) - café-only, deliberately
  // never added to the dashboard's own carousel/index.ts equivalent.
  externalUrl?: string | null;
  // Fixed-canvas embed round (migration 0100) - opt-in per slot, only
  // meaningful for mediaType 'website'. See MediaSlotRenderer.tsx's own
  // comment on its 'website' case for the full "why".
  websiteFixedCanvas?: boolean;
}

const VALID_MEDIA_TYPES = ["image", "mp4", "pdf", "webcam", "gyropedia", "website"];
const VALID_FIT_MODES = ["fill", "contain"];
const VALID_BANNER_SIZES = ["sm", "md", "lg", "xl", "xxl"];
const VALID_ZONES = ["both", "left", "right"];

// Empty/undefined is valid (mediaType 'website' selected, no URL entered
// yet - same "not configured" posture as an image slot with no
// mediaLibraryId) - only a NON-EMPTY, malformed value is rejected.
function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function defaultSlots(): CafeCarouselSlotRow[] {
  return Array.from({ length: 12 }, (_, i) => ({
    slotNumber: i + 1,
    enabled: 0,
    mediaType: "image",
    durationSeconds: 10,
    mediaLibraryId: null,
    cameraSlotNumber: null,
    cameraId: null,
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
    zone: "both",
    autoFullscreen: 0,
    ownerSlotUnlocked: 0,
    ownerSlotReserved: LEGACY_DEFAULT_RESERVED_SLOTS.includes(i + 1) ? 1 : 0,
    externalUrl: null,
    websiteFixedCanvas: 0,
    durationCapOverrideSeconds: null,
  }));
}

// isReserved: true means this slot is currently developer-controlled -
// CarouselSlotEditor.tsx (shared with the dashboard's own carousel
// editor) already knows how to grey this out/show "Reserved by
// AirfieldCentral" for any slot with isReserved true, so no frontend
// change is needed here at all - this is the only wiring CafeMediaPage's
// editor needs.
function rowToApi(row: CafeCarouselSlotRow) {
  const isReserved = !!row.ownerSlotReserved && !row.ownerSlotUnlocked;
  return {
    slotNumber: row.slotNumber,
    enabled: !!row.enabled,
    mediaType: row.mediaType,
    durationSeconds: row.durationSeconds,
    mediaLibraryId: row.mediaLibraryId,
    cameraSlotNumber: row.cameraSlotNumber,
    cameraId: row.cameraId,
    fitMode: row.fitMode,
    cropRect: { x: row.cropX, y: row.cropY, width: row.cropWidth, height: row.cropHeight },
    rotationDegrees: row.rotationDegrees,
    brightnessPercent: row.brightnessPercent,
    bannerText: row.bannerText,
    bannerOpacity: row.bannerOpacity,
    bannerFontSize: row.bannerFontSize,
    zone: row.zone,
    autoFullscreen: !!row.autoFullscreen,
    externalUrl: row.externalUrl,
    websiteFixedCanvas: !!row.websiteFixedCanvas,
    isReserved,
    durationCapOverrideSeconds: row.durationCapOverrideSeconds,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const { results } = await env.DB
    .prepare(
      `SELECT slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, cameraSlotNumber, cameraId, fitMode,
              cropX, cropY, cropWidth, cropHeight, rotationDegrees, brightnessPercent,
              bannerText, bannerOpacity, bannerFontSize, zone, autoFullscreen, ownerSlotUnlocked, ownerSlotReserved, externalUrl,
              websiteFixedCanvas, durationCapOverrideSeconds
       FROM cafe_carousel_slots WHERE organizationId = ? ORDER BY slotNumber`
    )
    .bind(organizationId)
    .all<CafeCarouselSlotRow>();

  const bySlot = new Map(results.map((row) => [row.slotNumber, row]));
  const slots = defaultSlots().map((fallback) => bySlot.get(fallback.slotNumber) ?? fallback);

  return jsonResponse({ slots: slots.map(rowToApi) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { slots?: CafeCarouselSlotInput[] } | null;
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
    if (slot.zone !== undefined && !VALID_ZONES.includes(slot.zone)) {
      return jsonResponse({ error: `zone must be one of: ${VALID_ZONES.join(", ")}` }, 400);
    }

    if (slot.mediaType === "webcam") {
      const hasLegacySlot = !!slot.cameraSlotNumber && slot.cameraSlotNumber >= 1 && slot.cameraSlotNumber <= 3;
      const hasNewCamera = typeof slot.cameraId === "string" && slot.cameraId.length > 0;
      if (!hasLegacySlot && !hasNewCamera) {
        return jsonResponse({ error: "cameraSlotNumber (1-3) or cameraId is required when mediaType is webcam" }, 400);
      }
      if (hasNewCamera) {
        const camera = await env.DB
          .prepare("SELECT c.id FROM cameras c JOIN tenants t ON t.id = c.tenant_id WHERE c.id = ? AND t.organization_id = ?")
          .bind(slot.cameraId, organizationId)
          .first<{ id: string }>();
        if (!camera) return jsonResponse({ error: `cameraId ${slot.cameraId} not found for your tenant` }, 400);
      }
    } else if (slot.mediaType === "website") {
      if (slot.externalUrl && !isValidHttpUrl(slot.externalUrl)) {
        return jsonResponse({ error: "externalUrl must be a valid http(s) URL" }, 400);
      }
    } else if (slot.mediaLibraryId) {
      const file = await env.DB
        .prepare("SELECT id FROM media_library WHERE id = ? AND organizationId = ?")
        .bind(slot.mediaLibraryId, organizationId)
        .first<{ id: string }>();
      if (!file) return jsonResponse({ error: `mediaLibraryId ${slot.mediaLibraryId} not found in your media library` }, 400);
    }
  }

  // Café Reserved Owner Slots round. Backend enforcement of what the
  // tenant's own editor UI already prevents by construction (a reserved
  // slot has no editing controls at all - see CarouselSlotEditor.tsx's
  // isReserved branch) - this is the "can't bypass via a direct API
  // call" half of that pair, matching the dashboard carousel route's own
  // isReservedSlot check. Absence of a row falls back to
  // LEGACY_DEFAULT_RESERVED_SLOTS (see that constant's own comment) -
  // not a real case for any tenant today, since migration 0102's
  // backfill already gave every existing 5/8/12 row a real
  // ownerSlotReserved value.
  const { results: currentRows } = await env.DB
    .prepare(`SELECT slotNumber, ownerSlotUnlocked, ownerSlotReserved, durationCapOverrideSeconds FROM cafe_carousel_slots WHERE organizationId = ?`)
    .bind(organizationId)
    .all<{ slotNumber: number; ownerSlotUnlocked: number; ownerSlotReserved: number; durationCapOverrideSeconds: number | null }>();
  const currentBySlot = new Map(currentRows.map((row) => [row.slotNumber, row]));

  function isReservedSlot(slotNumber: number): boolean {
    const row = currentBySlot.get(slotNumber);
    const reserved = row ? !!row.ownerSlotReserved : LEGACY_DEFAULT_RESERVED_SLOTS.includes(slotNumber);
    if (!reserved) return false;
    return !row?.ownerSlotUnlocked;
  }

  // Per-slot duration cap - server-side safety net matching
  // CarouselSlotEditor.tsx's own `max` attribute (the real, user-facing
  // boundary). A direct API call above the effective cap is silently
  // clamped down to it, not rejected - same "defense in depth, not a
  // user-facing error" posture the investigation asked for.
  function effectiveDurationCapSeconds(slotNumber: number): number {
    return currentBySlot.get(slotNumber)?.durationCapOverrideSeconds ?? DEFAULT_DURATION_CAP_SECONDS;
  }

  for (const slot of body.slots) {
    if (isReservedSlot(slot.slotNumber)) {
      return jsonResponse({ error: `Slot ${slot.slotNumber} is reserved by AirfieldCentral and cannot be edited.` }, 400);
    }
  }

  const now = new Date().toISOString();
  for (const slot of body.slots) {
    const cappedDurationSeconds = Math.min(slot.durationSeconds, effectiveDurationCapSeconds(slot.slotNumber));
    const isWebcamWithNewCamera = slot.mediaType === "webcam" && typeof slot.cameraId === "string" && slot.cameraId.length > 0;
    const mediaLibraryId = slot.mediaType === "webcam" ? null : slot.mediaLibraryId ?? null;
    const cameraSlotNumber = slot.mediaType === "webcam" && !isWebcamWithNewCamera ? slot.cameraSlotNumber ?? null : null;
    const cameraId = isWebcamWithNewCamera ? (slot.cameraId as string) : null;
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
    const autoFullscreen = slot.autoFullscreen ? 1 : 0;
    const externalUrl = slot.mediaType === "website" ? slot.externalUrl?.trim() || null : null;
    // Same "reset when not applicable" posture as externalUrl above -
    // meaningless (and potentially confusing if a slot is later switched
    // back to 'website') on any other mediaType.
    const websiteFixedCanvas = slot.mediaType === "website" && slot.websiteFixedCanvas ? 1 : 0;

    await env.DB
      .prepare(
        `INSERT INTO cafe_carousel_slots (
           organizationId, slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, cameraSlotNumber, cameraId,
           fitMode, cropX, cropY, cropWidth, cropHeight, rotationDegrees, brightnessPercent,
           bannerText, bannerOpacity, bannerFontSize, zone, autoFullscreen, externalUrl, websiteFixedCanvas, updatedAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(organizationId, slotNumber) DO UPDATE SET
           enabled = excluded.enabled,
           mediaType = excluded.mediaType,
           durationSeconds = excluded.durationSeconds,
           mediaLibraryId = excluded.mediaLibraryId,
           cameraSlotNumber = excluded.cameraSlotNumber,
           cameraId = excluded.cameraId,
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
           autoFullscreen = excluded.autoFullscreen,
           externalUrl = excluded.externalUrl,
           websiteFixedCanvas = excluded.websiteFixedCanvas,
           updatedAt = excluded.updatedAt`
      )
      .bind(
        organizationId,
        slot.slotNumber,
        slot.enabled ? 1 : 0,
        slot.mediaType,
        cappedDurationSeconds,
        mediaLibraryId,
        cameraSlotNumber,
        cameraId,
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
        autoFullscreen,
        externalUrl,
        websiteFixedCanvas,
        now
      )
      .run();
  }

  // Tenant-triggered refresh round - same reasoning and shape as the
  // dashboard carousel route's own trigger (functions/api/tenant/carousel/
  // index.ts) - a café tenant editing from home (the exact motivating
  // case: Meg's Cafe) has no access to the platform-admin "refresh all"
  // button and no way to know a manual refresh is even a thing. Scoped to
  // THIS tenant only, unconditional on every successful save, awaited but
  // itself timeout-bounded and error-swallowing - see that file's own
  // comment for the full reasoning, deliberately not duplicated here.
  const tenantSlug = await resolveTenantSlug(env.DB, organizationId);
  if (tenantSlug) {
    await triggerTenantRefresh(env, tenantSlug);
  }

  return jsonResponse({ ok: true });
};
