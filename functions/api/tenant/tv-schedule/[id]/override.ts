// Owner/admin only: POST /api/tenant/tv-schedule/:id/override - Wake
// now/Sleep now/Clear override on a tenant's OWN box. Tenant-facing TV
// schedule round (migration 0115) - mirrors functions/api/platform/
// pi-units/[id]/tv-schedule-override.ts exactly (same computeNextTransition
// import, same "holds until the next scheduled transition, or a 1-hour
// fallback if nothing's enabled yet" behaviour, same "an override wins
// even when the weekly schedule is disabled" posture) - not duplicated,
// imported from the same shared functions/api/_utils/tvSchedule.mjs.
//
// Same tenant_id ownership check as [id].ts in this same directory -
// see that file's own comment for the full reasoning (uniform 403,
// never 404, resolved via requireOwner's real tiered chain).
import { requireOwner, jsonResponse, type D1Database } from "../../../_utils/tenantAuth";
import { computeNextTransition } from "../../../_utils/tvSchedule.mjs";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface OverrideBody {
  action?: "wake" | "sleep" | "clear";
}

interface BoxRow {
  tenantId: number | null;
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
}

const FALLBACK_OVERRIDE_MS = 60 * 60 * 1000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const boxId = Number(params.id);
  if (!Number.isInteger(boxId)) return jsonResponse({ error: "Invalid box id" }, 400);

  const body = (await request.json<OverrideBody>().catch(() => null)) ?? {};
  if (body.action !== "wake" && body.action !== "sleep" && body.action !== "clear") {
    return jsonResponse({ error: "action must be one of: wake, sleep, clear" }, 400);
  }

  const tenantRow = await env.DB
    .prepare("SELECT id FROM tenants WHERE organization_id = ?")
    .bind(result.membership.organizationId)
    .first<{ id: number }>();
  if (!tenantRow) return jsonResponse({ error: "Tenant not found" }, 404);

  const box = await env.DB
    .prepare("SELECT tenant_id AS tenantId, tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson FROM pi_units WHERE id = ?")
    .bind(boxId)
    .first<BoxRow>();
  if (!box || box.tenantId !== tenantRow.id) return jsonResponse({ error: "Forbidden" }, 403);

  const now = new Date().toISOString();

  if (body.action === "clear") {
    await env.DB
      .prepare("UPDATE pi_units SET tv_schedule_override_state = NULL, tv_schedule_override_until = NULL, tv_schedule_override_issued_at = NULL, updated_at = ? WHERE id = ?")
      .bind(now, boxId)
      .run();
    return jsonResponse({ overrideState: null, overrideUntil: null, overrideActive: false });
  }

  const schedule = box.tvScheduleJson ? JSON.parse(box.tvScheduleJson) : null;
  const nextTransition = computeNextTransition(schedule, !!box.tvScheduleEnabled, new Date());
  const overrideUntil = (nextTransition ?? new Date(Date.now() + FALLBACK_OVERRIDE_MS)).toISOString();

  await env.DB
    .prepare("UPDATE pi_units SET tv_schedule_override_state = ?, tv_schedule_override_until = ?, tv_schedule_override_issued_at = ?, updated_at = ? WHERE id = ?")
    .bind(body.action, overrideUntil, now, now, boxId)
    .run();

  return jsonResponse({ overrideState: body.action, overrideUntil, overrideActive: true });
};
