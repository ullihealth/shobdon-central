// Public, UNAUTHENTICATED by BetterAuth's own standards (a Pi box has no
// session), gated instead by a single shared secret: POST
// /api/public/pi-units/tv-schedule - TV wake/sleep schedule round
// (migration 0114). This is what tv-schedule-check.py polls every
// minute. Also doubles as the box's first-ever heartbeat/check-in
// signal (pi_units never had one before this round - confirmed, see
// migration 0114's own comment) - every successful check updates
// tv_schedule_last_seen_at, so the Pi Fleet card can show "last seen"
// for the first time.
//
// AUTH: a single Cloudflare secret (env.PI_FLEET_KEY, set via
// `wrangler pages secret put PI_FLEET_KEY`), shared across every box -
// NOT a per-box token (amendment to the original design: a per-box
// token column was dropped entirely, see migration 0114's own comment).
// Sent as a header (X-Pi-Fleet-Key), never a query string - same
// posture as the key itself never living in D1, code, commits, or logs.
// Serial number is also sent as a header (X-Pi-Serial) for consistency,
// though it isn't secret - PI_FLEET_KEY is already what every box's
// request shares, so there's nothing it alone identifies that logging a
// serial would leak.
//
// Fails CLOSED: if the secret has never been set at all
// (env.PI_FLEET_KEY undefined), every request gets 503 - never silently
// treats "no key configured" as "no key required".
import { jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { timingSafeEqual } from "../../_utils/tvSchedule.mjs";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  PI_FLEET_KEY?: string;
}

interface UnitRow {
  id: number;
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
  tvScheduleOverrideState: string | null;
  tvScheduleOverrideUntil: string | null;
  tvScheduleOverrideIssuedAt: string | null;
  tvScheduleLastCommand: string | null;
  tvScheduleLastError: string | null;
}

interface CheckInBody {
  lastCommand?: "wake" | "sleep" | null;
  lastError?: string | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PI_FLEET_KEY) return jsonResponse({ error: "Fleet key not configured" }, 503);

  const key = request.headers.get("X-Pi-Fleet-Key");
  if (!key || !timingSafeEqual(key, env.PI_FLEET_KEY)) return jsonResponse({ error: "Unauthorized" }, 401);

  const serial = request.headers.get("X-Pi-Serial");
  if (!serial) return jsonResponse({ error: "X-Pi-Serial header is required" }, 400);

  const unit = await env.DB
    .prepare(
      `SELECT id, tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson,
              tv_schedule_override_state AS tvScheduleOverrideState, tv_schedule_override_until AS tvScheduleOverrideUntil,
              tv_schedule_override_issued_at AS tvScheduleOverrideIssuedAt,
              tv_schedule_last_command AS tvScheduleLastCommand, tv_schedule_last_error AS tvScheduleLastError
       FROM pi_units WHERE serial_number = ?`
    )
    .bind(serial)
    .first<UnitRow>();
  if (!unit) return jsonResponse({ error: "Unknown serial" }, 404);

  const body = (await request.json<CheckInBody>().catch(() => null)) ?? {};
  const now = new Date();
  const nowIso = now.toISOString();

  // Lazy expiry - an override past its own until-time is treated as gone
  // both in this response AND persisted as cleared, so a stale override
  // never lingers in D1 waiting for someone to notice. No separate cron
  // needed for this; every check-in is also the cleanup opportunity.
  const overrideExpired = !!unit.tvScheduleOverrideUntil && new Date(unit.tvScheduleOverrideUntil).getTime() <= now.getTime();
  const overrideState = overrideExpired ? null : unit.tvScheduleOverrideState;
  const overrideUntil = overrideExpired ? null : unit.tvScheduleOverrideUntil;
  // Per-press marker so the box can tell a NEW press of the same button
  // from the same override it already acted on (see migration 0116).
  const overrideIssuedAt = overrideState ? unit.tvScheduleOverrideIssuedAt : null;

  // One UPDATE per check-in (never two), per the round's own "keep it to
  // one small update, or only on change" instruction - last_seen_at is
  // always touched (that's the heartbeat), the override columns only
  // when they actually just expired, and last_command/last_error only
  // when the box reported a value that differs from what's already
  // stored (so a steady-state box polling every minute with nothing new
  // to report doesn't churn those two columns 1,440 times a day for no
  // reason).
  const setClauses = ["tv_schedule_last_seen_at = ?"];
  const bindings: unknown[] = [nowIso];
  if (overrideExpired) {
    setClauses.push("tv_schedule_override_state = NULL", "tv_schedule_override_until = NULL");
  }
  const reportedCommand = body.lastCommand !== undefined ? body.lastCommand : undefined;
  if (reportedCommand !== undefined && reportedCommand !== unit.tvScheduleLastCommand) {
    setClauses.push("tv_schedule_last_command = ?", "tv_schedule_last_command_at = ?");
    bindings.push(reportedCommand, nowIso);
  }
  const reportedError = body.lastError !== undefined ? body.lastError : undefined;
  if (reportedError !== undefined && reportedError !== unit.tvScheduleLastError) {
    setClauses.push("tv_schedule_last_error = ?");
    bindings.push(reportedError);
  }
  bindings.push(unit.id);

  await env.DB.prepare(`UPDATE pi_units SET ${setClauses.join(", ")} WHERE id = ?`).bind(...bindings).run();

  return jsonResponse({
    enabled: !!unit.tvScheduleEnabled,
    schedule: unit.tvScheduleJson ? JSON.parse(unit.tvScheduleJson) : null,
    overrideState,
    overrideUntil,
    overrideIssuedAt,
  });
};
