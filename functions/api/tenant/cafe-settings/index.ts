// Owner/admin/cafe: GET/PUT /api/tenant/cafe-settings - the Café
// template's own settings row (migration 0033, extended by 0035):
// split/full layout mode, the advertisement label toggle, the 10-slot
// footer ticker configuration (each slot independently enabled,
// migration 0035's Part B), and the ticker's own active style
// (background/font/height/scroll-speed, migration 0035's Part A).
// Was requireOwner (matching /design and /config's exact gate) until
// the cafe role was added - CafeMediaPage.tsx's own layout/ad-label/
// ticker editor calls this endpoint directly, so a cafe-role user
// reaching that page needs this too, or half the page 403s despite
// loading. Switched to requireRoles so 'cafe' can be added alongside
// owner/admin without granting it the same generic requireOwner used
// by unrelated owner-only pages elsewhere in the app.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

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
  tickerBackgroundColor: string;
  tickerBackgroundOpacity: number;
  tickerHeightPx: number;
  tickerFontFamily: string;
  tickerFontSizePx: number;
  tickerFontColor: string;
  tickerScrollSpeedPxPerSec: number;
  tickerGapPx: number;
}

type TickerSlotType = "clock" | "forecast" | "conditions" | "notice";

interface TickerSlotInput {
  position: number;
  type: TickerSlotType | null;
  // Independent of `type` - a slot can have a type picked but still be
  // switched off, mirroring ops_panel_state's safetyNotices `{enabled}`
  // pattern exactly (see functions/api/tenant/ops-panel/index.ts).
  // Optional on input for backwards compatibility with configs saved
  // before this field existed; always present on output.
  enabled?: boolean;
}

interface CafeSettingsInput {
  layoutMode: "split" | "full";
  adLabelEnabled: boolean;
  tickerEnabled: boolean;
  tickerSlots: TickerSlotInput[];
  tickerBackgroundColor: string;
  tickerBackgroundOpacity: number;
  tickerHeightPx: number;
  tickerFontFamily: string;
  tickerFontSizePx: number;
  tickerFontColor: string;
  tickerScrollSpeedPxPerSec: number;
  tickerGapPx: number;
}

const VALID_LAYOUT_MODES = ["split", "full"];
const VALID_TICKER_TYPES = ["clock", "forecast", "conditions", "notice"];
const VALID_FONT_FAMILIES = ["Inter", "Montserrat", "Oswald"];
const TICKER_SLOT_COUNT = 10;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

interface DefaultSettings {
  layoutMode: string;
  adLabelEnabled: boolean;
  tickerEnabled: boolean;
  tickerSlots: Required<TickerSlotInput>[];
  tickerBackgroundColor: string;
  tickerBackgroundOpacity: number;
  tickerHeightPx: number;
  tickerFontFamily: string;
  tickerFontSizePx: number;
  tickerFontColor: string;
  tickerScrollSpeedPxPerSec: number;
  tickerGapPx: number;
}

// Matches migration 0035/0036's own column DEFAULTs and
// tickerStyleStore.ts's DEFAULT_TICKER_STYLE exactly - three
// independent copies of "today's implicit look" (SQL default, this
// default, the frontend default) would drift; this one is the
// authoritative fallback when no row exists yet at all.
function defaultSettings(): DefaultSettings {
  return {
    layoutMode: "full",
    adLabelEnabled: false,
    tickerEnabled: false,
    tickerSlots: Array.from({ length: TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true })),
    tickerBackgroundColor: "#0f172a",
    tickerBackgroundOpacity: 100,
    tickerHeightPx: 64,
    tickerFontFamily: "Inter",
    tickerFontSizePx: 16,
    tickerFontColor: "#ffffff",
    tickerScrollSpeedPxPerSec: 80,
    tickerGapPx: 0,
  };
}

function rowToApi(row: CafeSettingsRow) {
  const slots = (JSON.parse(row.tickerSlotsJson) as TickerSlotInput[]).map((slot) => ({
    position: slot.position,
    type: slot.type,
    // Missing on an older saved config (pre-migration-0035) = enabled,
    // matching safetyNotices' own `enabled !== false` convention -
    // never silently mutes every existing tenant's ticker the moment
    // this field first appears.
    enabled: slot.enabled !== false,
  }));
  return {
    layoutMode: row.layoutMode,
    adLabelEnabled: !!row.adLabelEnabled,
    tickerEnabled: !!row.tickerEnabled,
    tickerSlots: slots,
    tickerBackgroundColor: row.tickerBackgroundColor,
    tickerBackgroundOpacity: row.tickerBackgroundOpacity,
    tickerHeightPx: row.tickerHeightPx,
    tickerFontFamily: row.tickerFontFamily,
    tickerFontSizePx: row.tickerFontSizePx,
    tickerFontColor: row.tickerFontColor,
    tickerScrollSpeedPxPerSec: row.tickerScrollSpeedPxPerSec,
    tickerGapPx: row.tickerGapPx,
  };
}

const SELECT_COLUMNS =
  "layoutMode, adLabelEnabled, tickerEnabled, tickerSlotsJson, tickerBackgroundColor, tickerBackgroundOpacity, tickerHeightPx, tickerFontFamily, tickerFontSizePx, tickerFontColor, tickerScrollSpeedPxPerSec, tickerGapPx";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare(`SELECT ${SELECT_COLUMNS} FROM cafe_template_settings WHERE organizationId = ?`)
    .bind(organizationId)
    .first<CafeSettingsRow>();

  if (!row) return jsonResponse(defaultSettings());

  return jsonResponse(rowToApi(row));
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "cafe"]);
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
      if (slot.enabled !== undefined && typeof slot.enabled !== "boolean") {
        return jsonResponse({ error: "tickerSlots[].enabled must be a boolean" }, 400);
      }
    }
  }
  if (body.tickerBackgroundColor !== undefined && !HEX_COLOR_PATTERN.test(body.tickerBackgroundColor)) {
    return jsonResponse({ error: "tickerBackgroundColor must be a #rrggbb hex colour" }, 400);
  }
  if (body.tickerFontColor !== undefined && !HEX_COLOR_PATTERN.test(body.tickerFontColor)) {
    return jsonResponse({ error: "tickerFontColor must be a #rrggbb hex colour" }, 400);
  }
  if (
    body.tickerBackgroundOpacity !== undefined &&
    (!Number.isInteger(body.tickerBackgroundOpacity) || body.tickerBackgroundOpacity < 0 || body.tickerBackgroundOpacity > 100)
  ) {
    return jsonResponse({ error: "tickerBackgroundOpacity must be an integer 0-100" }, 400);
  }
  if (body.tickerHeightPx !== undefined && (!Number.isInteger(body.tickerHeightPx) || body.tickerHeightPx < 24 || body.tickerHeightPx > 200)) {
    return jsonResponse({ error: "tickerHeightPx must be an integer 24-200" }, 400);
  }
  if (body.tickerFontFamily !== undefined && !VALID_FONT_FAMILIES.includes(body.tickerFontFamily)) {
    return jsonResponse({ error: `tickerFontFamily must be one of: ${VALID_FONT_FAMILIES.join(", ")}` }, 400);
  }
  if (body.tickerFontSizePx !== undefined && (!Number.isInteger(body.tickerFontSizePx) || body.tickerFontSizePx < 8 || body.tickerFontSizePx > 72)) {
    return jsonResponse({ error: "tickerFontSizePx must be an integer 8-72" }, 400);
  }
  if (
    body.tickerScrollSpeedPxPerSec !== undefined &&
    (!Number.isInteger(body.tickerScrollSpeedPxPerSec) || body.tickerScrollSpeedPxPerSec < 0 || body.tickerScrollSpeedPxPerSec > 500)
  ) {
    // 0 is valid and deliberate (static) - the lower bound is inclusive.
    return jsonResponse({ error: "tickerScrollSpeedPxPerSec must be an integer 0-500" }, 400);
  }
  if (body.tickerGapPx !== undefined && (!Number.isInteger(body.tickerGapPx) || body.tickerGapPx < 0 || body.tickerGapPx > 2000)) {
    // 0 (today's tight default) is valid and inclusive; the upper bound
    // is generous enough that a message can fully scroll off-screen
    // before the next appears even on a 4K-wide bar.
    return jsonResponse({ error: "tickerGapPx must be an integer 0-2000" }, 400);
  }

  // Fetch-current-merge-write-back, same shape as platform/tenants/[id].ts's
  // PATCH - PUT here may only include a subset of fields (e.g. the editor
  // saves the ticker on/off toggle independently of the layout toggle,
  // or a style control independently of everything else).
  const current = await env.DB
    .prepare(`SELECT ${SELECT_COLUMNS} FROM cafe_template_settings WHERE organizationId = ?`)
    .bind(organizationId)
    .first<CafeSettingsRow>();
  const currentDefaults = defaultSettings();
  const currentApi = current ? rowToApi(current) : currentDefaults;

  const next = {
    layoutMode: body.layoutMode ?? currentApi.layoutMode,
    adLabelEnabled: body.adLabelEnabled ?? currentApi.adLabelEnabled,
    tickerEnabled: body.tickerEnabled ?? currentApi.tickerEnabled,
    tickerSlots: (body.tickerSlots ?? currentApi.tickerSlots).map((slot) => ({
      position: slot.position,
      type: slot.type,
      enabled: slot.enabled !== false,
    })),
    tickerBackgroundColor: body.tickerBackgroundColor ?? currentApi.tickerBackgroundColor,
    tickerBackgroundOpacity: body.tickerBackgroundOpacity ?? currentApi.tickerBackgroundOpacity,
    tickerHeightPx: body.tickerHeightPx ?? currentApi.tickerHeightPx,
    tickerFontFamily: body.tickerFontFamily ?? currentApi.tickerFontFamily,
    tickerFontSizePx: body.tickerFontSizePx ?? currentApi.tickerFontSizePx,
    tickerFontColor: body.tickerFontColor ?? currentApi.tickerFontColor,
    tickerScrollSpeedPxPerSec: body.tickerScrollSpeedPxPerSec ?? currentApi.tickerScrollSpeedPxPerSec,
    tickerGapPx: body.tickerGapPx ?? currentApi.tickerGapPx,
  };

  const nowIso = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO cafe_template_settings (
         organizationId, layoutMode, adLabelEnabled, tickerEnabled, tickerSlotsJson,
         tickerBackgroundColor, tickerBackgroundOpacity, tickerHeightPx, tickerFontFamily,
         tickerFontSizePx, tickerFontColor, tickerScrollSpeedPxPerSec, tickerGapPx, updatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         layoutMode = excluded.layoutMode,
         adLabelEnabled = excluded.adLabelEnabled,
         tickerEnabled = excluded.tickerEnabled,
         tickerSlotsJson = excluded.tickerSlotsJson,
         tickerBackgroundColor = excluded.tickerBackgroundColor,
         tickerBackgroundOpacity = excluded.tickerBackgroundOpacity,
         tickerHeightPx = excluded.tickerHeightPx,
         tickerFontFamily = excluded.tickerFontFamily,
         tickerFontSizePx = excluded.tickerFontSizePx,
         tickerFontColor = excluded.tickerFontColor,
         tickerScrollSpeedPxPerSec = excluded.tickerScrollSpeedPxPerSec,
         tickerGapPx = excluded.tickerGapPx,
         updatedAt = excluded.updatedAt`
    )
    .bind(
      organizationId,
      next.layoutMode,
      next.adLabelEnabled ? 1 : 0,
      next.tickerEnabled ? 1 : 0,
      JSON.stringify(next.tickerSlots),
      next.tickerBackgroundColor,
      next.tickerBackgroundOpacity,
      next.tickerHeightPx,
      next.tickerFontFamily,
      next.tickerFontSizePx,
      next.tickerFontColor,
      next.tickerScrollSpeedPxPerSec,
      next.tickerGapPx,
      nowIso
    )
    .run();

  return jsonResponse(next);
};
