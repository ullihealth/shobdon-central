// Owner/admin/atc-role: GET/PUT /api/tenant/ops-panel - the ATC-control page's
// dynamic Ops Panel state (active runway end, circuit direction,
// airfield info text, up to 10 manual safety notice rows each with its
// own NAME, size, and enabled/disabled flag, whether the automated NOTAM
// feed is shown at all, and how often the live dashboard rotates between
// its normal and NOTAMS states). Deliberately separate from
// tenant/config.ts (which stays requireOwner-only) so atc members get
// exactly this one write surface, not the rest of /config's owner-only
// areas.
//
// Also the single source of truth CafeMediaPage.tsx's notice CRUD reads/
// writes - same endpoint, same table, same JSON column ATC Control
// already used. Notices gained `id` (stable, needed so a café ticker
// slot can reference one SPECIFIC notice) and `name` (a tenant-given
// label, needed now that there can be several distinct notices, not one
// undifferentiated block of text) - both self-healed onto any
// pre-existing notice that predates this field (see ensureNoticeShape
// below), so nothing already saved is lost or requires a manual data
// migration.
//
// 'cafe' role added to both role lists below (not just 'atc') for
// exactly the reason above - CafeMediaPage.tsx's notice editor calls
// this same endpoint directly, so a cafe-role user reaching that page
// needs write access here too, or the ticker's Notice-slot editing
// silently 403s despite the rest of the page working.
import { requireRoles, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { resolveTenantSlug, triggerTenantRefresh } from "../../_utils/refreshDisplays";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  // "Refresh displays" round - AtcControlPage.tsx's "Update Dashboard"
  // save used to fire fetch(REFRESH_TRIGGER_URL) itself, client-side,
  // with no tenant awareness at all - since that flag was global, saving
  // ANY tenant's ops panel silently reloaded EVERY tenant's live
  // dashboard. Moved server-side instead of just adding a `?tenant=`
  // param to the client's own call: this handler already knows the
  // caller's true tenant via the authenticated session (requireRoles
  // below), so resolving the refresh target here makes it structurally
  // impossible to target the wrong tenant - there's no client-supplied
  // tenant identity to get wrong. See _utils/refreshDisplays.ts's own
  // comment for the CAPTURE_KEY/FALLBACK_CAPTURE_KEY shape this shares
  // with capture-refresh.ts/capture-logs.ts.
  CAPTURE_KEY?: string;
}

interface OpsPanelRow {
  activeRunwayEnd: string;
  circuitDirection: string;
  airfieldInfoText: string;
  safetyNoticesJson: string;
  showAutoNotams: number;
  notamsCarouselIntervalSeconds: number;
  // Independent per-state durations for RightInfoPanel.tsx's rotation
  // (migration 0077), replacing notamsCarouselIntervalSeconds above -
  // that field is left in place, unused, until this is confirmed
  // working end-to-end.
  notamsOpsDurationSeconds: number;
  notamsFullDurationSeconds: number;
  noticesDurationSeconds: number;
  weatherSummaryChartEnabled: number;
  weatherSummaryStateADurationSeconds: number;
  weatherSummaryStateBDurationSeconds: number;
  runwaysClosed: number;
  // SADDS automation round (migration 0076) - when true,
  // functions/api/ingest/weather.ts keeps activeRunwayEnd/
  // circuitDirection in sync with SADDS captures on every ingest, and
  // the PUT handler below rejects any manual change to those two
  // fields unless this same request also turns it off.
  runwayAutomationEnabled: number;
}

interface SafetyNoticeInput {
  // Optional on input - a brand-new notice from either editor may not
  // have generated one yet; ensureNoticeShape() below fills it in
  // server-side either way, so this is never actually missing by the
  // time it's persisted.
  id?: string;
  name?: string;
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  enabled: boolean;
}

interface SafetyNoticeStored {
  id: string;
  name: string;
  text: string;
  size: "sm" | "md" | "lg" | "xl";
  enabled: boolean;
}

interface OpsPanelInput {
  activeRunwayEnd: string;
  circuitDirection: "left" | "right";
  airfieldInfoText: string;
  safetyNotices: SafetyNoticeInput[];
  showAutoNotams: boolean;
  notamsCarouselIntervalSeconds: number;
  notamsOpsDurationSeconds: number;
  notamsFullDurationSeconds: number;
  noticesDurationSeconds: number;
  weatherSummaryChartEnabled: boolean;
  weatherSummaryStateADurationSeconds: number;
  weatherSummaryStateBDurationSeconds: number;
  // ATC-triggered override (migration 0054) - when true, every render
  // location that shows activeRunwayEnd/circuitDirection shows
  // "RUNWAYS CLOSED" instead, everywhere at once (see RightInfoPanel.tsx's
  // own comment). Independent of activeRunwayEnd/circuitDirection
  // themselves - closing runways doesn't clear which one was last
  // active, so re-opening restores the same values without ATC needing
  // to re-pick them.
  runwaysClosed: boolean;
  // SADDS automation round (migration 0076) - see OpsPanelRow's own
  // comment. Always sent explicitly by AtcControlPage.tsx (this is a
  // full-replace endpoint, same as every other field here), never
  // inferred from omission.
  runwayAutomationEnabled: boolean;
}

const AIRFIELD_INFO_MAX_LENGTH = 60;
const SAFETY_NOTICE_MAX_LENGTH = 40;
const SAFETY_NOTICE_NAME_MAX_LENGTH = 40;
const SAFETY_NOTICE_MAX_ROWS = 10;
const NOTICE_SIZES = ["sm", "md", "lg", "xl"];
const NOTAMS_INTERVAL_MIN_SECONDS = 2;
const NOTAMS_INTERVAL_MAX_SECONDS = 30;
// Same bounds as the NOTAMS interval above, per the approved plan - no
// reason for Weather Summary's own rotation to allow a wider range.
const WEATHER_SUMMARY_DURATION_MIN_SECONDS = 2;
const WEATHER_SUMMARY_DURATION_MAX_SECONDS = 30;

// Backfills `id`/`name` onto any notice that predates those fields
// (every notice saved before this change) - crypto.randomUUID() is
// available in the Workers runtime same as any modern browser. `name`
// defaults to a truncated copy of the text rather than a generic
// "Untitled" placeholder, since the text is usually already a
// reasonable label at a glance (e.g. "Fish & Chips Offer" as both name
// AND text is a completely normal, valid notice - this only kicks in
// when `name` is genuinely absent, not to second-guess one that's
// already been explicitly set, including to something short).
//
// Over-length self-heal round (found investigating a stuck-tenant
// report - 5 of 7 tenants had a seed notice one character over
// SAFETY_NOTICE_MAX_LENGTH, baked into migrations 0026/0031 and copied
// by cloneTenant.ts at onboarding time, long before this field's limit
// was ever enforced by the PUT below). `text` is now truncated here the
// same way `name` already was - trimEnd() after slicing so a cut that
// lands mid-whitespace doesn't leave a trailing space, matching what a
// user typing right up to the limit in the UI would end up with anyway
// (AtcControlPage.tsx's own onChange already slices to this same
// constant while editing). A stale over-length value from before this
// limit existed - or before it was tightened - now silently heals back
// into range on the very next save instead of permanently blocking
// every future save of this tenant's entire ops panel, regardless of
// what was actually being changed.
function ensureNoticeShape(notice: SafetyNoticeInput): SafetyNoticeStored {
  const text = notice.text.slice(0, SAFETY_NOTICE_MAX_LENGTH).trimEnd();
  return {
    id: notice.id && notice.id.trim() ? notice.id : crypto.randomUUID(),
    name: notice.name && notice.name.trim() ? notice.name.trim().slice(0, SAFETY_NOTICE_NAME_MAX_LENGTH).trimEnd() : text.slice(0, SAFETY_NOTICE_NAME_MAX_LENGTH),
    text,
    size: notice.size,
    enabled: notice.enabled,
  };
}

// True if ANY notice in the array was missing id/name, or had
// over-length text/name, before ensureNoticeShape ran - GET uses this to
// decide whether the healed array needs writing back at all, so a row
// that's already fully healed never triggers a needless UPDATE on every
// read. The length checks matter here, not just id/name: without them, a
// stale over-length notice would come back truncated in THIS response
// (ensureNoticeShape always truncates) but never actually get persisted
// until the next PUT - a real, if transient, mismatch between what GET
// just returned and what's still sitting in the row, which the length
// checks here close the same way the id/name ones already did.
function neededHealing(raw: SafetyNoticeInput[]): boolean {
  return raw.some(
    (notice) =>
      !notice.id ||
      !notice.name ||
      notice.text.length > SAFETY_NOTICE_MAX_LENGTH ||
      notice.text !== notice.text.trimEnd() ||
      (notice.name && notice.name.length > SAFETY_NOTICE_NAME_MAX_LENGTH)
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare(
      "SELECT activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, notamsOpsDurationSeconds, notamsFullDurationSeconds, noticesDurationSeconds, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds, runwaysClosed, runwayAutomationEnabled FROM ops_panel_state WHERE organizationId = ?"
    )
    .bind(organizationId)
    .first<OpsPanelRow>();

  if (!row) {
    return jsonResponse({
      activeRunwayEnd: "",
      circuitDirection: "left",
      airfieldInfoText: "",
      safetyNotices: [],
      showAutoNotams: true,
      notamsCarouselIntervalSeconds: 5,
      notamsOpsDurationSeconds: 5,
      notamsFullDurationSeconds: 5,
      noticesDurationSeconds: 5,
      weatherSummaryChartEnabled: false,
      weatherSummaryStateADurationSeconds: 8,
      weatherSummaryStateBDurationSeconds: 5,
      runwaysClosed: false,
      // Matches migration 0076's own DEFAULT 1 - a tenant that's never
      // opened ATC Control yet still reports automation as ON, same as
      // the real column default a first-ever row would get.
      runwayAutomationEnabled: true,
    });
  }

  // Self-healing id/name/length backfill - a GET that writes is unusual,
  // but this is a deliberate, idempotent, one-time correction (see
  // ensureNoticeShape's own comment), not an ordinary side effect: every
  // existing notice saved before id/name existed, or before today's
  // length limits were enforced, gets fixed up HERE and PERSISTED
  // immediately, so the same notice reads the same (and has the same
  // stable id) on every subsequent read - both ATC Control and CAFE
  // MEDIA call this same GET, so whichever page is opened first triggers
  // the heal and the other sees the already-healed result.
  const rawNotices = JSON.parse(row.safetyNoticesJson) as SafetyNoticeInput[];
  const safetyNotices = rawNotices.map(ensureNoticeShape);
  // Same principle for the single airfieldInfoText field - truncated
  // on every response regardless (so GET never returns a stale
  // over-length value even before this UPDATE lands), persisted back
  // only when it was actually too long, same "don't write on every read"
  // posture as the notices healing just above.
  const airfieldInfoText = row.airfieldInfoText.slice(0, AIRFIELD_INFO_MAX_LENGTH).trimEnd();
  if (neededHealing(rawNotices)) {
    await env.DB
      .prepare("UPDATE ops_panel_state SET safetyNoticesJson = ? WHERE organizationId = ?")
      .bind(JSON.stringify(safetyNotices), organizationId)
      .run();
  }
  if (airfieldInfoText !== row.airfieldInfoText) {
    await env.DB
      .prepare("UPDATE ops_panel_state SET airfieldInfoText = ? WHERE organizationId = ?")
      .bind(airfieldInfoText, organizationId)
      .run();
  }

  return jsonResponse({
    activeRunwayEnd: row.activeRunwayEnd,
    circuitDirection: row.circuitDirection,
    airfieldInfoText,
    safetyNotices,
    showAutoNotams: !!row.showAutoNotams,
    notamsCarouselIntervalSeconds: row.notamsCarouselIntervalSeconds,
    notamsOpsDurationSeconds: row.notamsOpsDurationSeconds,
    notamsFullDurationSeconds: row.notamsFullDurationSeconds,
    noticesDurationSeconds: row.noticesDurationSeconds,
    weatherSummaryChartEnabled: !!row.weatherSummaryChartEnabled,
    weatherSummaryStateADurationSeconds: row.weatherSummaryStateADurationSeconds,
    weatherSummaryStateBDurationSeconds: row.weatherSummaryStateBDurationSeconds,
    runwaysClosed: !!row.runwaysClosed,
    runwayAutomationEnabled: !!row.runwayAutomationEnabled,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireRoles(request, env, ["owner", "admin", "atc", "cafe"]);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as OpsPanelInput | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  if (typeof body.activeRunwayEnd !== "string" || !body.activeRunwayEnd.trim()) {
    return jsonResponse({ error: "activeRunwayEnd is required" }, 400);
  }
  if (body.circuitDirection !== "left" && body.circuitDirection !== "right") {
    return jsonResponse({ error: "circuitDirection must be 'left' or 'right'" }, 400);
  }
  if (typeof body.airfieldInfoText !== "string") {
    return jsonResponse({ error: "airfieldInfoText must be a string" }, 400);
  }
  // Same self-heal principle as safety notice text/name above - a stale
  // value already over AIRFIELD_INFO_MAX_LENGTH (from before this limit
  // existed or was tightened) is truncated, not a reason to block the
  // rest of this save.
  body.airfieldInfoText = body.airfieldInfoText.slice(0, AIRFIELD_INFO_MAX_LENGTH).trimEnd();
  if (!Array.isArray(body.safetyNotices) || body.safetyNotices.length > SAFETY_NOTICE_MAX_ROWS) {
    return jsonResponse({ error: `safetyNotices must be an array of at most ${SAFETY_NOTICE_MAX_ROWS} rows` }, 400);
  }
  // Shape/type validation only here - genuinely malformed input (wrong
  // type, missing required field, invalid enum) is still rejected
  // outright. An over-length text/name is deliberately NOT one of those
  // reasons any more - see ensureNoticeShape's own comment: it's healed
  // (truncated) below instead of blocking this entire save, the same way
  // a stale id/name already was. Rejecting here would still let a stale
  // over-length value from BEFORE this request permanently block every
  // future save of fields that have nothing to do with it.
  for (const notice of body.safetyNotices) {
    if (
      typeof notice !== "object" ||
      notice === null ||
      typeof notice.text !== "string" ||
      !NOTICE_SIZES.includes(notice.size) ||
      typeof notice.enabled !== "boolean" ||
      (notice.id !== undefined && typeof notice.id !== "string") ||
      (notice.name !== undefined && typeof notice.name !== "string")
    ) {
      return jsonResponse(
        {
          error: `each safety notice must be {name?: string, text: string, size: 'sm'|'md'|'lg'|'xl', enabled: boolean}`,
        },
        400
      );
    }
  }
  if (typeof body.showAutoNotams !== "boolean") {
    return jsonResponse({ error: "showAutoNotams must be a boolean" }, 400);
  }
  if (typeof body.runwaysClosed !== "boolean") {
    return jsonResponse({ error: "runwaysClosed must be a boolean" }, 400);
  }
  if (typeof body.runwayAutomationEnabled !== "boolean") {
    return jsonResponse({ error: "runwayAutomationEnabled must be a boolean" }, 400);
  }
  if (
    !Number.isInteger(body.notamsCarouselIntervalSeconds) ||
    body.notamsCarouselIntervalSeconds < NOTAMS_INTERVAL_MIN_SECONDS ||
    body.notamsCarouselIntervalSeconds > NOTAMS_INTERVAL_MAX_SECONDS
  ) {
    return jsonResponse(
      { error: `notamsCarouselIntervalSeconds must be an integer between ${NOTAMS_INTERVAL_MIN_SECONDS} and ${NOTAMS_INTERVAL_MAX_SECONDS}` },
      400
    );
  }
  // Independent per-state durations (migration 0077) - same bounds as
  // notamsCarouselIntervalSeconds above, which these three directly
  // split apart (one shared value -> one per rotation state), not a
  // fresh design decision of their own.
  if (
    !Number.isInteger(body.notamsOpsDurationSeconds) ||
    body.notamsOpsDurationSeconds < NOTAMS_INTERVAL_MIN_SECONDS ||
    body.notamsOpsDurationSeconds > NOTAMS_INTERVAL_MAX_SECONDS
  ) {
    return jsonResponse(
      { error: `notamsOpsDurationSeconds must be an integer between ${NOTAMS_INTERVAL_MIN_SECONDS} and ${NOTAMS_INTERVAL_MAX_SECONDS}` },
      400
    );
  }
  if (
    !Number.isInteger(body.notamsFullDurationSeconds) ||
    body.notamsFullDurationSeconds < NOTAMS_INTERVAL_MIN_SECONDS ||
    body.notamsFullDurationSeconds > NOTAMS_INTERVAL_MAX_SECONDS
  ) {
    return jsonResponse(
      { error: `notamsFullDurationSeconds must be an integer between ${NOTAMS_INTERVAL_MIN_SECONDS} and ${NOTAMS_INTERVAL_MAX_SECONDS}` },
      400
    );
  }
  if (
    !Number.isInteger(body.noticesDurationSeconds) ||
    body.noticesDurationSeconds < NOTAMS_INTERVAL_MIN_SECONDS ||
    body.noticesDurationSeconds > NOTAMS_INTERVAL_MAX_SECONDS
  ) {
    return jsonResponse(
      { error: `noticesDurationSeconds must be an integer between ${NOTAMS_INTERVAL_MIN_SECONDS} and ${NOTAMS_INTERVAL_MAX_SECONDS}` },
      400
    );
  }
  if (typeof body.weatherSummaryChartEnabled !== "boolean") {
    return jsonResponse({ error: "weatherSummaryChartEnabled must be a boolean" }, 400);
  }
  if (
    !Number.isInteger(body.weatherSummaryStateADurationSeconds) ||
    body.weatherSummaryStateADurationSeconds < WEATHER_SUMMARY_DURATION_MIN_SECONDS ||
    body.weatherSummaryStateADurationSeconds > WEATHER_SUMMARY_DURATION_MAX_SECONDS
  ) {
    return jsonResponse(
      {
        error: `weatherSummaryStateADurationSeconds must be an integer between ${WEATHER_SUMMARY_DURATION_MIN_SECONDS} and ${WEATHER_SUMMARY_DURATION_MAX_SECONDS}`,
      },
      400
    );
  }
  if (
    !Number.isInteger(body.weatherSummaryStateBDurationSeconds) ||
    body.weatherSummaryStateBDurationSeconds < WEATHER_SUMMARY_DURATION_MIN_SECONDS ||
    body.weatherSummaryStateBDurationSeconds > WEATHER_SUMMARY_DURATION_MAX_SECONDS
  ) {
    return jsonResponse(
      {
        error: `weatherSummaryStateBDurationSeconds must be an integer between ${WEATHER_SUMMARY_DURATION_MIN_SECONDS} and ${WEATHER_SUMMARY_DURATION_MAX_SECONDS}`,
      },
      400
    );
  }

  // SADDS automation lock: while automation is CURRENTLY on (the stored
  // value, not the incoming body's), the only way to change
  // activeRunwayEnd/circuitDirection is to also turn automation off in
  // this exact same request - matching the frontend's own confirm-and-
  // disable-in-one-action flow (AtcControlPage.tsx), and preventing any
  // other caller from silently overwriting SADDS-managed values.
  // Everything else on this full-replace endpoint stays completely
  // unaffected by this check either way.
  const current = await env.DB
    .prepare("SELECT activeRunwayEnd, circuitDirection, runwayAutomationEnabled FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ activeRunwayEnd: string; circuitDirection: string; runwayAutomationEnabled: number }>();

  // Gated on `current` existing at all - a brand-new tenant's very first
  // save (no row yet) has nothing SADDS-managed to protect, but used to
  // 409 anyway: with no row, the "current" baseline defaulted to ""/
  // "left" (both fields below), while the frontend always resolves
  // activeRunwayEnd to a REAL identifier on load (never the literal
  // empty string - see AtcControlPage.tsx's own `opsPanel.activeRunwayEnd
  // || (endA ?? '08')`), so any tenant whose real runway end isn't
  // literally "" tripped this as a false "manual change" the instant
  // they clicked Update Dashboard, before ever touching anything.
  // Reproduced for both a parent-linked tenant with no runway_groups of
  // its own (inherits the parent's real identifiers) and a fully
  // unlinked tenant with its own real runway_groups - neither is
  // specific to the parent/sub-tenant inheritance work, both are just
  // "first save ever" hitting this same gap. Once a row exists, the
  // lock behaves exactly as before - this only skips the check for a
  // tenant that has never saved here yet.
  if (current) {
    const automationCurrentlyEnabled = !!current.runwayAutomationEnabled;
    if (automationCurrentlyEnabled && body.runwayAutomationEnabled !== false) {
      if (body.activeRunwayEnd !== current.activeRunwayEnd || body.circuitDirection !== current.circuitDirection) {
        return jsonResponse(
          { error: "Runway and circuit direction are controlled by SADDS automation. Disable automation to set them manually." },
          409
        );
      }
    }
  }

  // Empty rows are dropped rather than stored as blanks - keeps the
  // public config's safetyNotices array free of placeholder empties that
  // would otherwise render as blank lines under the auto NOTAM text.
  // ensureNoticeShape normalizes (trims and length-caps both name and
  // text) and guarantees every surviving notice has a stable id - a
  // brand-new notice from either editor gets one minted here if the
  // client didn't already send one. The filter below checks the
  // ALREADY-truncated text, not what the client sent - a notice that
  // was pure trailing whitespace past the limit (truncates/trims to "")
  // is correctly dropped as empty, not kept as a now-blank row.
  const safetyNotices = body.safetyNotices
    .map((n) => ensureNoticeShape({ ...n, text: n.text.trim() }))
    .filter((n) => n.text.length > 0);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, notamsOpsDurationSeconds, notamsFullDurationSeconds, noticesDurationSeconds, weatherSummaryChartEnabled, weatherSummaryStateADurationSeconds, weatherSummaryStateBDurationSeconds, runwaysClosed, runwayAutomationEnabled, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET
         activeRunwayEnd = excluded.activeRunwayEnd,
         circuitDirection = excluded.circuitDirection,
         airfieldInfoText = excluded.airfieldInfoText,
         safetyNoticesJson = excluded.safetyNoticesJson,
         showAutoNotams = excluded.showAutoNotams,
         notamsCarouselIntervalSeconds = excluded.notamsCarouselIntervalSeconds,
         notamsOpsDurationSeconds = excluded.notamsOpsDurationSeconds,
         notamsFullDurationSeconds = excluded.notamsFullDurationSeconds,
         noticesDurationSeconds = excluded.noticesDurationSeconds,
         weatherSummaryChartEnabled = excluded.weatherSummaryChartEnabled,
         weatherSummaryStateADurationSeconds = excluded.weatherSummaryStateADurationSeconds,
         weatherSummaryStateBDurationSeconds = excluded.weatherSummaryStateBDurationSeconds,
         runwaysClosed = excluded.runwaysClosed,
         runwayAutomationEnabled = excluded.runwayAutomationEnabled,
         updatedAt = excluded.updatedAt`
    )
    .bind(
      organizationId,
      body.activeRunwayEnd,
      body.circuitDirection,
      body.airfieldInfoText,
      JSON.stringify(safetyNotices),
      body.showAutoNotams ? 1 : 0,
      body.notamsCarouselIntervalSeconds,
      body.notamsOpsDurationSeconds,
      body.notamsFullDurationSeconds,
      body.noticesDurationSeconds,
      body.weatherSummaryChartEnabled ? 1 : 0,
      body.weatherSummaryStateADurationSeconds,
      body.weatherSummaryStateBDurationSeconds,
      body.runwaysClosed ? 1 : 0,
      body.runwayAutomationEnabled ? 1 : 0,
      now
    )
    .run();

  // Refreshes this SAME tenant's own live displays, never any other
  // tenant's - see _utils/refreshDisplays.ts's own comment for why this
  // moved server-side. Awaited (Pages Functions have no ctx.waitUntil in
  // this codebase's own hand-rolled PagesFunction type - an unawaited
  // promise risks being dropped once this function returns), but
  // triggerTenantRefresh swallows its own errors and is timeout-bounded,
  // so a slow/failed Worker call adds a small bounded amount of latency
  // here, never fails this response.
  const tenantSlug = await resolveTenantSlug(env.DB, organizationId);
  if (tenantSlug) {
    await triggerTenantRefresh(env, tenantSlug);
  }

  return jsonResponse({ ok: true });
};
