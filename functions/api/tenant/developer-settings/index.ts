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

  return jsonResponse({
    reverseCompassNeedle: !!row?.reverseCompassNeedle,
    pilotClockMode: row?.pilotClockMode ?? "summer",
    captureIntervalSeconds: row?.captureIntervalSeconds ?? 60,
  });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireDeveloper(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as
    | { reverseCompassNeedle?: boolean; pilotClockMode?: string; captureIntervalSeconds?: number }
    | null;
  if (
    !body ||
    (body.reverseCompassNeedle === undefined && body.pilotClockMode === undefined && body.captureIntervalSeconds === undefined)
  ) {
    return jsonResponse({ error: "Provide reverseCompassNeedle, pilotClockMode, and/or captureIntervalSeconds" }, 400);
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

  return jsonResponse({ ok: true });
};
