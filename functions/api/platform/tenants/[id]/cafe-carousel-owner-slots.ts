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

interface OwnerSlotRow {
  slotNumber: number;
  enabled: number;
  mediaType: string;
  mediaLibraryId: string | null;
  ownerSlotUnlocked: number;
  ownerContentAssigned: number;
  r2Key: string | null;
  filename: string | null;
  mp4DurationSeconds: number | null;
}

interface OwnerSlotInput {
  slotNumber: number;
  enabled: boolean;
  mediaType: "image" | "mp4" | "pdf";
  mediaLibraryId: string | null;
  ownerSlotUnlocked: boolean;
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
        `SELECT cs.slotNumber AS slotNumber, cs.enabled AS enabled, cs.mediaType AS mediaType, cs.mediaLibraryId AS mediaLibraryId,
                cs.ownerSlotUnlocked AS ownerSlotUnlocked, cs.ownerContentAssigned AS ownerContentAssigned,
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
      mediaLibraryId: row?.mediaLibraryId ?? null,
      ownerSlotUnlocked: !!row?.ownerSlotUnlocked,
      ownerContentAssigned: !!row?.ownerContentAssigned,
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

    await env.DB
      .prepare(
        `INSERT INTO cafe_carousel_slots (organizationId, slotNumber, enabled, mediaType, durationSeconds, mediaLibraryId, ownerSlotUnlocked, ownerContentAssigned, updatedAt)
         VALUES (?, ?, ?, ?, 10, ?, ?, ?, ?)
         ON CONFLICT(organizationId, slotNumber) DO UPDATE SET
           enabled = excluded.enabled,
           mediaType = excluded.mediaType,
           durationSeconds = 10,
           mediaLibraryId = excluded.mediaLibraryId,
           ownerSlotUnlocked = excluded.ownerSlotUnlocked,
           ownerContentAssigned = excluded.ownerContentAssigned,
           updatedAt = excluded.updatedAt`
      )
      .bind(organizationId, slot.slotNumber, slot.enabled ? 1 : 0, slot.mediaType, mediaLibraryId, slot.ownerSlotUnlocked ? 1 : 0, ownerContentAssigned, now)
      .run();
  }

  return jsonResponse(await loadState(env.DB, organizationId, env.MEDIA_PUBLIC_BASE_URL));
};
