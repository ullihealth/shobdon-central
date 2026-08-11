// Platform-admin only: GET/PUT /api/platform/tenants/:id/pilot-view -
// manages a specific tenant's Pilot View sticky-ticker content
// (migration 0070, tenants.pilot_ticker_slots_json). Same requirePlatformAdmin
// + explicit :id path-param shape as carousel-owner-slots.ts - :id names
// which tenant to touch, independent of the caller's own resolved org.
//
// Reuses CafeTicker.tsx's existing TickerSlot JSON shape verbatim
// ({position, type, enabled, noticeId, textMode, manualText}) and the
// exact same validation cafe-settings/index.ts already applies to its
// own tickerSlots field - this is a second, independently-configured
// instance of the same content model, not a new vocabulary.
//
// GET also returns this tenant's current safetyNotices (ops_panel_state)
// purely so the admin editor's "notice" slot type can offer a dropdown
// of this SPECIFIC tenant's own named notices - the platform-admin
// caller here isn't a member of the tenant's own org, so it can't use
// the tenant-session-scoped GET /api/tenant/ops-panel route the café
// editor relies on for the same picker. No new endpoint for this alone;
// it just rides along on this response.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

type TickerSlotType = "clock" | "forecast" | "conditions" | "notice" | "fuel";

interface TickerSlotInput {
  position: number;
  type: TickerSlotType | null;
  enabled?: boolean;
  noticeId?: string;
  textMode?: boolean;
  manualText?: string;
  // Per-slot text colour - see CafeTicker.tsx's own TickerSlot.textColor
  // comment and cafe-settings/index.ts's identical field (this is a
  // second, independently-configured instance of the same content
  // model, same posture as every other field in this interface).
  textColor?: string;
}

interface SafetyNoticeRow {
  id?: string;
  name?: string;
  text: string;
  size: string;
  enabled: boolean;
}

const VALID_TICKER_TYPES = ["clock", "forecast", "conditions", "notice", "fuel"];
const MAX_MANUAL_TEXT_LENGTH = 200;
// Same pattern cafe-settings/index.ts's own PUT already uses for its
// whole-ticker colour fields - this file has no colour field of its own
// to validate against until textColor.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// Fewer slots than the café ticker's 10 - a phone's readable ticker
// width is narrower than a TV's, so a shorter fixed slot count keeps
// the admin editor meaningful (a slot nobody will ever see scroll past
// isn't worth configuring).
const PILOT_TICKER_SLOT_COUNT = 8;

function defaultTickerSlots(): TickerSlotInput[] {
  return Array.from({ length: PILOT_TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true }));
}

function normalizeSlot(slot: TickerSlotInput): TickerSlotInput {
  return {
    position: slot.position,
    type: slot.type,
    enabled: slot.enabled !== false,
    noticeId: slot.noticeId,
    textMode: !!slot.textMode,
    manualText: slot.manualText,
    textColor: slot.textColor,
  };
}

async function resolveTenant(db: D1Database, tenantId: number): Promise<{ organizationId: string | null; tickerSlotsJson: string } | null> {
  return db
    .prepare("SELECT organization_id AS organizationId, pilot_ticker_slots_json AS tickerSlotsJson FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ organizationId: string | null; tickerSlotsJson: string }>();
}

async function loadNotices(db: D1Database, organizationId: string | null): Promise<SafetyNoticeRow[]> {
  if (!organizationId) return [];
  const row = await db
    .prepare("SELECT safetyNoticesJson FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ safetyNoticesJson: string }>();
  if (!row) return [];
  try {
    return JSON.parse(row.safetyNoticesJson) as SafetyNoticeRow[];
  } catch {
    return [];
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await resolveTenant(env.DB, tenantId);
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);

  let tickerSlots: TickerSlotInput[];
  try {
    const parsed = JSON.parse(tenant.tickerSlotsJson) as TickerSlotInput[];
    tickerSlots = parsed.length === PILOT_TICKER_SLOT_COUNT ? parsed.map(normalizeSlot) : defaultTickerSlots();
  } catch {
    tickerSlots = defaultTickerSlots();
  }

  const notices = await loadNotices(env.DB, tenant.organizationId);

  return jsonResponse({ tickerSlots, notices });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId)) return jsonResponse({ error: "Invalid tenant id" }, 400);

  const tenant = await resolveTenant(env.DB, tenantId);
  if (!tenant) return jsonResponse({ error: "Tenant not found" }, 404);

  const body = (await request.json().catch(() => null)) as { tickerSlots?: TickerSlotInput[] } | null;
  if (!body || !Array.isArray(body.tickerSlots)) return jsonResponse({ error: "Invalid JSON body" }, 400);
  if (body.tickerSlots.length !== PILOT_TICKER_SLOT_COUNT) {
    return jsonResponse({ error: `tickerSlots must be an array of exactly ${PILOT_TICKER_SLOT_COUNT} entries` }, 400);
  }
  for (const slot of body.tickerSlots) {
    if (!Number.isInteger(slot.position) || slot.position < 1 || slot.position > PILOT_TICKER_SLOT_COUNT) {
      return jsonResponse({ error: `tickerSlots[].position must be 1-${PILOT_TICKER_SLOT_COUNT}` }, 400);
    }
    if (slot.type !== null && !VALID_TICKER_TYPES.includes(slot.type as string)) {
      return jsonResponse({ error: `tickerSlots[].type must be one of: ${VALID_TICKER_TYPES.join(", ")} or null` }, 400);
    }
    if (slot.enabled !== undefined && typeof slot.enabled !== "boolean") {
      return jsonResponse({ error: "tickerSlots[].enabled must be a boolean" }, 400);
    }
    if (slot.noticeId !== undefined && typeof slot.noticeId !== "string") {
      return jsonResponse({ error: "tickerSlots[].noticeId must be a string" }, 400);
    }
    if (slot.textMode !== undefined && typeof slot.textMode !== "boolean") {
      return jsonResponse({ error: "tickerSlots[].textMode must be a boolean" }, 400);
    }
    if (slot.manualText !== undefined) {
      if (typeof slot.manualText !== "string") {
        return jsonResponse({ error: "tickerSlots[].manualText must be a string" }, 400);
      }
      if (slot.manualText.length > MAX_MANUAL_TEXT_LENGTH) {
        return jsonResponse({ error: `tickerSlots[].manualText must be ${MAX_MANUAL_TEXT_LENGTH} characters or fewer` }, 400);
      }
    }
    if (slot.textColor !== undefined && !HEX_COLOR_PATTERN.test(slot.textColor)) {
      return jsonResponse({ error: "tickerSlots[].textColor must be a #rrggbb hex colour" }, 400);
    }
  }

  const tickerSlots = body.tickerSlots.map(normalizeSlot);
  await env.DB
    .prepare("UPDATE tenants SET pilot_ticker_slots_json = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(tickerSlots), new Date().toISOString(), tenantId)
    .run();

  const notices = await loadNotices(env.DB, tenant.organizationId);
  return jsonResponse({ tickerSlots, notices });
};
