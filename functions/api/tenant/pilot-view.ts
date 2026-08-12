// Owner/admin/atc: GET/PUT /api/tenant/pilot-view - the Pilot Panel's own
// settings (tenants.pilot_ticker_slots_json, migration 0070, and
// tenants.pilot_background_override_json, migration 0085). Tenant-session
// scoped (requireRoles resolves organizationId from the caller's own
// session/Host, no :id param) - a deliberate SEPARATE endpoint from
// functions/api/platform/tenants/[id]/pilot-view.ts, not a shared one.
// That platform-admin route stays exactly as-is (still used by
// PlatformTenantsPage.tsx's own cross-tenant editor, requirePlatformAdmin,
// explicit :id) - the two are genuinely different auth contexts (a
// developer editing any tenant vs. a tenant admin editing only their own),
// same posture as cafe-settings/index.ts existing independently of any
// platform-admin equivalent.
//
// 'atc' included in the role list (unlike cafe-settings' owner/admin/cafe)
// per Pilot Panel's own spec - this page needs to be reachable by the atc
// role, and every read this endpoint does (including the desktopTickerSlots
// convenience field below) must be too, so an atc-role admin can use the
// "Copy from desktop ticker" button without hitting a 403 against a
// differently-scoped endpoint.
import { requireRoles, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
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
  // comment and cafe-settings/index.ts's identical field. Same posture
  // here as the platform-admin pilot-view.ts's own copy of this field.
  textColor?: string;
}

interface BackgroundOverrideInput {
  backgroundColor: string;
}

const VALID_TICKER_TYPES = ["clock", "forecast", "conditions", "notice", "fuel"];
const MAX_MANUAL_TEXT_LENGTH = 200;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// Same slot count as the platform-admin pilot-view.ts - one shared
// content model, two independently-scoped editors over it.
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

// Read-only convenience for the "Copy from desktop ticker" button -
// cafe_template_settings is keyed by the same organizationId, so this is
// a plain second read alongside the tenants row, not a join. Returns []
// rather than erroring when the tenant has no café row at all (never
// used Dashboard Manager's ticker) - same graceful-degradation posture
// every other optional field in this file already takes.
async function loadDesktopTickerSlots(db: D1Database, organizationId: string): Promise<unknown[]> {
  const row = await db
    .prepare("SELECT tickerSlotsJson FROM cafe_template_settings WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ tickerSlotsJson: string }>();
  if (!row?.tickerSlotsJson) return [];
  try {
    return JSON.parse(row.tickerSlotsJson) as unknown[];
  } catch {
    return [];
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT pilot_ticker_slots_json AS tickerSlotsJson, pilot_background_override_json AS backgroundOverrideJson FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ tickerSlotsJson: string; backgroundOverrideJson: string | null }>();

  let tickerSlots: TickerSlotInput[];
  try {
    const parsed = row?.tickerSlotsJson ? (JSON.parse(row.tickerSlotsJson) as TickerSlotInput[]) : [];
    tickerSlots = parsed.length === PILOT_TICKER_SLOT_COUNT ? parsed.map(normalizeSlot) : defaultTickerSlots();
  } catch {
    tickerSlots = defaultTickerSlots();
  }

  let backgroundOverride: BackgroundOverrideInput | null = null;
  if (row?.backgroundOverrideJson) {
    try {
      const parsed = JSON.parse(row.backgroundOverrideJson) as { backgroundColor?: unknown };
      if (typeof parsed.backgroundColor === "string") backgroundOverride = { backgroundColor: parsed.backgroundColor };
    } catch {
      backgroundOverride = null;
    }
  }

  const desktopTickerSlots = await loadDesktopTickerSlots(env.DB, organizationId);

  return jsonResponse({ tickerSlots, backgroundOverride, desktopTickerSlots });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as {
    tickerSlots?: TickerSlotInput[];
    backgroundOverride?: BackgroundOverrideInput | null;
  } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  if (body.tickerSlots !== undefined) {
    if (!Array.isArray(body.tickerSlots) || body.tickerSlots.length !== PILOT_TICKER_SLOT_COUNT) {
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
  }

  if (body.backgroundOverride !== undefined && body.backgroundOverride !== null) {
    if (!HEX_COLOR_PATTERN.test(body.backgroundOverride.backgroundColor ?? "")) {
      return jsonResponse({ error: "backgroundOverride.backgroundColor must be a #rrggbb hex colour" }, 400);
    }
  }

  // Read-modify-write, same shape as the platform-admin pilot-view.ts's
  // own PUT - either field left out of the body keeps its current stored
  // value rather than being wiped, so the ticker section and background
  // section can each save independently without clobbering the other.
  const existing = await env.DB
    .prepare("SELECT pilot_ticker_slots_json AS tickerSlotsJson, pilot_background_override_json AS backgroundOverrideJson FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ tickerSlotsJson: string; backgroundOverrideJson: string | null }>();

  const nextTickerSlotsJson =
    body.tickerSlots !== undefined ? JSON.stringify(body.tickerSlots.map(normalizeSlot)) : (existing?.tickerSlotsJson ?? "[]");
  const nextBackgroundOverrideJson =
    body.backgroundOverride !== undefined
      ? body.backgroundOverride === null
        ? null
        : JSON.stringify({ backgroundColor: body.backgroundOverride.backgroundColor })
      : (existing?.backgroundOverrideJson ?? null);

  await env.DB
    .prepare("UPDATE tenants SET pilot_ticker_slots_json = ?, pilot_background_override_json = ?, updated_at = ? WHERE organization_id = ?")
    .bind(nextTickerSlotsJson, nextBackgroundOverrideJson, new Date().toISOString(), organizationId)
    .run();

  const tickerSlots: TickerSlotInput[] = JSON.parse(nextTickerSlotsJson);
  const backgroundOverride: BackgroundOverrideInput | null = nextBackgroundOverrideJson ? JSON.parse(nextBackgroundOverrideJson) : null;
  const desktopTickerSlots = await loadDesktopTickerSlots(env.DB, organizationId);

  return jsonResponse({ tickerSlots, backgroundOverride, desktopTickerSlots });
};
