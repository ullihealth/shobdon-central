// Platform-admin only: POST /api/platform/pi-units/:id/tv-schedule-override
// TV wake/sleep schedule round (migration 0114) - "Wake now"/"Sleep
// now"/"Clear override" buttons on the Pi Fleet card. A dedicated action
// route, not a field on the generic PATCH ([id].ts) - same reasoning
// notes.ts already established for this table: an override is an
// ACTION with real server-side computation (what time should control
// hand back to the normal schedule), not a client-supplied field value
// a full-row-rewrite PATCH could safely accept verbatim.
//
// Deliberately applies even when the weekly schedule itself is
// disabled/unset (see tvSchedule.mjs's computeDesiredState - an active
// override always wins) - useful for testing the CEC wiring on a box
// before a full week's schedule has ever been saved, which is exactly
// how Jeff's own weekend test with the Tiger box is expected to start.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { computeNextTransition } from "../../../_utils/tvSchedule.mjs";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface UnitRow {
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
}

interface OverrideBody {
  action?: "wake" | "sleep" | "clear";
}

// Fallback hold when no enabled weekly schedule exists yet to bound the
// override by computeNextTransition - an override must never hold
// forever by accident. 1 hour is plenty for a manual test click, far
// short of "indefinitely".
const FALLBACK_OVERRIDE_MS = 60 * 60 * 1000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const unitId = Number(params.id);
  if (!Number.isFinite(unitId)) return jsonResponse({ error: "Invalid unit id" }, 400);

  const body = (await request.json<OverrideBody>().catch(() => null)) ?? {};
  if (body.action !== "wake" && body.action !== "sleep" && body.action !== "clear") {
    return jsonResponse({ error: "action must be one of: wake, sleep, clear" }, 400);
  }

  const unit = await env.DB
    .prepare("SELECT tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson FROM pi_units WHERE id = ?")
    .bind(unitId)
    .first<UnitRow>();
  if (!unit) return jsonResponse({ error: "Pi unit not found" }, 404);

  const now = new Date().toISOString();

  if (body.action === "clear") {
    await env.DB
      .prepare("UPDATE pi_units SET tv_schedule_override_state = NULL, tv_schedule_override_until = NULL, updated_at = ? WHERE id = ?")
      .bind(now, unitId)
      .run();
    return jsonResponse({ overrideState: null, overrideUntil: null, overrideActive: false });
  }

  const schedule = unit.tvScheduleJson ? JSON.parse(unit.tvScheduleJson) : null;
  const nextTransition = computeNextTransition(schedule, !!unit.tvScheduleEnabled, new Date());
  const overrideUntil = (nextTransition ?? new Date(Date.now() + FALLBACK_OVERRIDE_MS)).toISOString();

  await env.DB
    .prepare("UPDATE pi_units SET tv_schedule_override_state = ?, tv_schedule_override_until = ?, updated_at = ? WHERE id = ?")
    .bind(body.action, overrideUntil, now, unitId)
    .run();

  return jsonResponse({ overrideState: body.action, overrideUntil, overrideActive: true });
};
