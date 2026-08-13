// Developer-only: GET/PUT /api/tenant/developer-settings.
//
// Two fields (reverseCompassNeedle, pilotClockMode), both stored on the
// shared ops_panel_state row but written via this SEPARATE, narrowly-
// scoped endpoint rather than the general /api/tenant/ops-panel PUT -
// that route does a full-replace of every ops-panel field and is
// reachable by owner/admin/atc (via /atc-control), so routing either
// field through it would risk an atc save silently resetting a
// developer-only diagnostic flag it doesn't even know exists. A
// dedicated narrow UPDATE avoids that entirely.
import { requireDeveloper, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

// /pilot header clock round - 'summer' matches LiveClock.tsx's own
// pre-existing behaviour exactly (Europe/London local time, dynamic
// BST/GMT depending on real DST), so it's every tenant's default and a
// genuine no-op until deliberately changed. See migration 0075's own
// comment for the full reasoning.
const PILOT_CLOCK_MODES = ["summer", "gmt", "utc"] as const;
type PilotClockMode = (typeof PILOT_CLOCK_MODES)[number];

// ADISP capture polling interval (migration 0080) - a fixed set, not a
// free-form number, matching /runways' own dropdown exactly. 60 is
// today's hardcoded script behaviour and stays the default; testing
// starts at 15/30, not 5, per explicit instruction not to jump straight
// to the shortest interval untested.
const CAPTURE_INTERVAL_SECONDS_OPTIONS = [5, 10, 15, 30, 60] as const;
type CaptureIntervalSeconds = (typeof CAPTURE_INTERVAL_SECONDS_OPTIONS)[number];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const row = await env.DB
    .prepare("SELECT reverseCompassNeedle, pilot_clock_mode AS pilotClockMode, captureIntervalSeconds FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ reverseCompassNeedle: number; pilotClockMode: string | null; captureIntervalSeconds: number | null }>();

  // Separate table (tenants, not ops_panel_state) and separate query -
  // display_width_cm (migration 0088) is a physical fact about the
  // tenant's own hardware, same table arrow_tailwind_kt/has_physical_atc
  // live on, not an ops-panel display setting. Bundled into this same
  // endpoint/page anyway since it's still "developer-only, no self-
  // service" the same as everything else here - see DeveloperToolsPage's
  // own DisplayWidthField comment for the full reasoning.
  const tenantRow = await env.DB
    .prepare("SELECT display_width_cm AS displayWidthCm FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ displayWidthCm: number | null }>();

  return jsonResponse({
    reverseCompassNeedle: !!row?.reverseCompassNeedle,
    pilotClockMode: row?.pilotClockMode ?? "summer",
    captureIntervalSeconds: row?.captureIntervalSeconds ?? 60,
    displayWidthCm: tenantRow?.displayWidthCm ?? null,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as
    | {
        reverseCompassNeedle?: boolean;
        pilotClockMode?: string;
        captureIntervalSeconds?: number;
        displayWidthCm?: number | null;
      }
    | null;
  if (
    !body ||
    (body.reverseCompassNeedle === undefined &&
      body.pilotClockMode === undefined &&
      body.captureIntervalSeconds === undefined &&
      body.displayWidthCm === undefined)
  ) {
    return jsonResponse({ error: "Provide reverseCompassNeedle, pilotClockMode, captureIntervalSeconds, and/or displayWidthCm" }, 400);
  }
  if (body.reverseCompassNeedle !== undefined && typeof body.reverseCompassNeedle !== "boolean") {
    return jsonResponse({ error: "reverseCompassNeedle must be a boolean" }, 400);
  }
  if (body.pilotClockMode !== undefined && !PILOT_CLOCK_MODES.includes(body.pilotClockMode as PilotClockMode)) {
    return jsonResponse({ error: `pilotClockMode must be one of: ${PILOT_CLOCK_MODES.join(", ")}` }, 400);
  }
  if (
    body.captureIntervalSeconds !== undefined &&
    !CAPTURE_INTERVAL_SECONDS_OPTIONS.includes(body.captureIntervalSeconds as CaptureIntervalSeconds)
  ) {
    return jsonResponse({ error: `captureIntervalSeconds must be one of: ${CAPTURE_INTERVAL_SECONDS_OPTIONS.join(", ")}` }, 400);
  }
  // null is a valid, meaningful value here (explicitly clears back to
  // "not yet confirmed" - see migration 0088's own comment), so only
  // reject non-null values that aren't a sane positive width - not
  // `!body.displayWidthCm`, which would also reject 0/null-ish falsy
  // values that should either be a validation error (0) or the valid
  // clear-to-null case (handled separately, not by this check).
  if (
    body.displayWidthCm !== undefined &&
    body.displayWidthCm !== null &&
    (typeof body.displayWidthCm !== "number" || !Number.isFinite(body.displayWidthCm) || body.displayWidthCm <= 0)
  ) {
    return jsonResponse({ error: "displayWidthCm must be a positive number of centimetres, or null" }, 400);
  }

  const current = await env.DB
    .prepare("SELECT reverseCompassNeedle, pilot_clock_mode AS pilotClockMode, captureIntervalSeconds FROM ops_panel_state WHERE organizationId = ?")
    .bind(organizationId)
    .first<{ reverseCompassNeedle: number; pilotClockMode: string | null; captureIntervalSeconds: number | null }>();

  const nextReverseCompassNeedle = body.reverseCompassNeedle ?? !!current?.reverseCompassNeedle;
  const nextPilotClockMode = body.pilotClockMode ?? current?.pilotClockMode ?? "summer";
  const nextCaptureIntervalSeconds = body.captureIntervalSeconds ?? current?.captureIntervalSeconds ?? 60;

  // Same upsert shape as club_theme/camera_slots - INSERT with sensible
  // defaults for a tenant that's never touched /atc-control yet (so no
  // ops_panel_state row exists), ON CONFLICT just updates these fields,
  // matching the "own narrow write" scope this endpoint exists for in
  // the first place.
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, reverseCompassNeedle, pilot_clock_mode, captureIntervalSeconds, updatedAt)
       VALUES (?, '', 'left', '', '[]', 1, 5, ?, ?, ?, ?)
       ON CONFLICT(organizationId) DO UPDATE SET reverseCompassNeedle = excluded.reverseCompassNeedle, pilot_clock_mode = excluded.pilot_clock_mode, captureIntervalSeconds = excluded.captureIntervalSeconds, updatedAt = excluded.updatedAt`
    )
    .bind(organizationId, nextReverseCompassNeedle ? 1 : 0, nextPilotClockMode, nextCaptureIntervalSeconds, now)
    .run();

  // Separate table, separate targeted UPDATE (not part of the
  // ops_panel_state upsert above) - only fires when displayWidthCm is
  // actually part of this request, so toggling e.g. reverseCompassNeedle
  // alone never touches the tenants row at all. Every tenant row already
  // exists by the time this endpoint is reachable (requireDeveloper
  // resolves a real membership/organization), unlike ops_panel_state
  // which may not have a row yet - a plain UPDATE, not an upsert, is
  // correct here.
  if (body.displayWidthCm !== undefined) {
    await env.DB
      .prepare("UPDATE tenants SET display_width_cm = ?, updated_at = ? WHERE organization_id = ?")
      .bind(body.displayWidthCm, now, organizationId)
      .run();
  }

  return jsonResponse({ ok: true });
};
