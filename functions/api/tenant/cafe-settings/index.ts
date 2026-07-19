// Owner-only: GET/PUT /api/tenant/cafe-settings - the Café template's
// own settings row (migration 0033): split/full layout mode, the
// advertisement label toggle, and the 10-slot footer ticker
// configuration. requireOwner, matching /design and /config's exact
// gate - this is tenant-wide display configuration, same category as
// those pages, not an ATC/media-role concern.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface CafeSettingsRow {
  layoutMode: string;
  adLabelEnabled: number;
  tickerEnabled: number;
  tickerSlotsJson: string;
}

type TickerSlotType = "clock" | "forecast" | "conditions" | "notice";

interface TickerSlotInput {
  position: number;
  type: TickerSlotType | null;
}

interface CafeSettingsInput {
  layoutMode: "split" | "full";
  adLabelEnabled: boolean;
  tickerEnabled: boolean;
  tickerSlots: TickerSlotInput[];
}

const VALID_LAYOUT_MODES = ["split", "full"];
const VALID_TICKER_TYPES = ["clock", "forecast", "conditions", "notice"];
const TICKER_SLOT_COUNT = 10;

function defaultSettings(): { layoutMode: string; adLabelEnabled: boolean; tickerEnabled: boolean; tickerSlots: TickerSlotInput[] } {
  return {
    layoutMode: "full",
    adLabelEnabled: false,
    tickerEnabled: false,
    tickerSlots: Array.from({ length: TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null })),
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT layoutMode, adLabelEnabled, tickerEnabled, tickerSlotsJson FROM cafe_template_settings WHERE organizationId = ?")
    .bind(organizationId)
    .first<CafeSettingsRow>();

  if (!row) return jsonResponse(defaultSettings());

  return jsonResponse({
    layoutMode: row.layoutMode,
    adLabelEnabled: !!row.adLabelEnabled,
    tickerEnabled: !!row.tickerEnabled,
    tickerSlots: JSON.parse(row.tickerSlotsJson),
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as Partial<CafeSettingsInput> | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  if (body.layoutMode !== undefined && !VALID_LAYOUT_MODES.includes(body.layoutMode)) {
    return jsonResponse({ error: `layoutMode must be one of: ${VALID_LAYOUT_MODES.join(", ")}` }, 400);
  }
  if (body.tickerSlots !== undefined) {
    if (!Array.isArray(body.tickerSlots) || body.tickerSlots.length !== TICKER_SLOT_COUNT) {
      return jsonResponse({ error: `tickerSlots must be an array of exactly ${TICKER_SLOT_COUNT} entries` }, 400);
    }
    for (const slot of body.tickerSlots) {
      if (!Number.isInteger(slot.position) || slot.position < 1 || slot.position > TICKER_SLOT_COUNT) {
        return jsonResponse({ error: `tickerSlots[].position must be 1-${TICKER_SLOT_COUNT}` }, 400);
      }
      if (slot.type !== null && !VALID_TICKER_TYPES.includes(slot.type as string)) {
        return jsonResponse({ error: `tickerSlots[].type must be one of: ${VALID_TICKER_TYPES.join(", ")} or null` }, 400);
      }
    }
  }

  // Fetch-current-merge-write-back, same shape as platform/tenants/[id].ts's
  // PATCH - PUT here may only include a subset of fields (e.g. the editor
  // saves the ticker on/off toggle independently of the layout toggle).
  const current = await env.DB
    .prepare("SELECT layoutMode, adLabelEnabled, tickerEnabled, tickerSlotsJson FROM cafe_template_settings WHERE organizationId = ?")
    .bind(organizationId)
    .first<CafeSettingsRow>();
  const currentDefaults = defaultSettings();

  const next = {
    layoutMode: body.layoutMode ?? current?.layoutMode ?? currentDefaults.layoutMode,
    adLabelEnabled: body.adLabelEnabled ?? (current ? !!current.adLabelEnabled : currentDefaults.adLabelEnabled),
    tickerEnabled: body.tickerEnabled ?? (current ? !!current.tickerEnabled : currentDefaults.tickerEnabled),
    tickerSlots: body.tickerSlots ?? (current ? JSON.parse(current.tickerSlotsJson) : currentDefaults.tickerSlots),
  };

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO cafe_template_settings (organizationId, layoutMode, adLabelEnabled, tickerEnabled, tickerSlotsJson, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         layoutMode = excluded.layoutMode,
         adLabelEnabled = excluded.adLabelEnabled,
         tickerEnabled = excluded.tickerEnabled,
         tickerSlotsJson = excluded.tickerSlotsJson,
         updatedAt = excluded.updatedAt`
    )
    .bind(organizationId, next.layoutMode, next.adLabelEnabled ? 1 : 0, next.tickerEnabled ? 1 : 0, JSON.stringify(next.tickerSlots), now)
    .run();

  return jsonResponse(next);
};
