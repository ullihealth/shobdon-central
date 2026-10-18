// Owner/admin only: PATCH /api/tenant/tv-schedule/:id - saves a tenant's
// OWN box's TV schedule (enabled + per-day wake/sleep times). Tenant-
// facing TV schedule round (migration 0115).
//
// SERVER is the real boundary (not the sidebar's own visibility check,
// which is cosmetic): every request here re-confirms
// pi_units.tenant_id equals the CALLER'S OWN resolved tenant - resolved
// via requireOwner's full tiered chain (explicit ?org=, dev-preview
// cookie, Host header, switcher cookie, only falling back to earliest
// membership when nothing else applies), never "whichever tenant
// happens to be first" - same resolution every other tenant-scoped
// settings route in this app already uses, nothing new invented here.
// A box belonging to a DIFFERENT tenant (or unlinked, tenant_id NULL)
// gets a uniform 403 "Forbidden" - never 404 - so this route never
// confirms or denies that some other tenant's box id even exists.
//
// A tenant may change exactly two things on pi_units: tv_schedule_
// enabled and tv_schedule_json. Nothing else - no serial/hostname/
// status/contact/image fields are reachable through this route at all
// (contrast functions/api/platform/pi-units/[id].ts's much wider
// PatchBody, which stays developer-only).
//
// validateSchedule() imported from the SAME shared module Pi Fleet's
// own PATCH route uses - not duplicated (same same-day-only rule:
// overnight schedules rejected, see that module's own comment).
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { validateSchedule } from "../../_utils/tvSchedule.mjs";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface PatchBody {
  enabled?: boolean;
  schedule?: Record<string, { wake: string; sleep: string; off: boolean }> | null;
}

interface BoxRow {
  tenantId: number | null;
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const boxId = Number(params.id);
  if (!Number.isInteger(boxId)) return jsonResponse({ error: "Invalid box id" }, 400);

  const body = (await request.json<PatchBody>().catch(() => null)) ?? {};
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return jsonResponse({ error: "enabled must be a boolean" }, 400);
  }
  if (body.schedule !== undefined && body.schedule !== null) {
    const scheduleError = validateSchedule(body.schedule);
    if (scheduleError) return jsonResponse({ error: scheduleError }, 400);
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
  // Uniform 403 whether the box doesn't exist at all or belongs to a
  // different tenant - never 404, so this route can't be used to probe
  // which box ids exist.
  if (!box || box.tenantId !== tenantRow.id) return jsonResponse({ error: "Forbidden" }, 403);

  const nextEnabled = body.enabled ?? !!box.tvScheduleEnabled;
  const nextScheduleJsonRaw = body.schedule !== undefined ? (body.schedule === null ? null : JSON.stringify(body.schedule)) : box.tvScheduleJson;
  if (nextEnabled && !nextScheduleJsonRaw) {
    return jsonResponse({ error: "Cannot enable the TV schedule without a saved schedule" }, 400);
  }

  // Same "saving clears any active override" behaviour Pi Fleet's own
  // PATCH route has (2026-10-18 fix - an override left over from before
  // a schedule was saved must not keep overriding it) - only when this
  // request is actually the Save action (either field present).
  const clearsOverride = body.enabled !== undefined || body.schedule !== undefined;

  await env.DB
    .prepare(
      `UPDATE pi_units SET tv_schedule_enabled = ?, tv_schedule_json = ?,
              tv_schedule_override_state = CASE WHEN ? THEN NULL ELSE tv_schedule_override_state END,
              tv_schedule_override_until = CASE WHEN ? THEN NULL ELSE tv_schedule_override_until END,
              updated_at = ?
       WHERE id = ?`
    )
    .bind(nextEnabled ? 1 : 0, nextScheduleJsonRaw, clearsOverride ? 1 : 0, clearsOverride ? 1 : 0, new Date().toISOString(), boxId)
    .run();

  const updated = await env.DB
    .prepare(
      `SELECT tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson,
              tv_schedule_override_state AS tvScheduleOverrideState, tv_schedule_override_until AS tvScheduleOverrideUntil
       FROM pi_units WHERE id = ?`
    )
    .bind(boxId)
    .first<{ tvScheduleEnabled: number; tvScheduleJson: string | null; tvScheduleOverrideState: string | null; tvScheduleOverrideUntil: string | null }>();

  return jsonResponse({
    enabled: !!updated?.tvScheduleEnabled,
    schedule: updated?.tvScheduleJson ? JSON.parse(updated.tvScheduleJson) : null,
    overrideState: updated?.tvScheduleOverrideState ?? null,
    overrideUntil: updated?.tvScheduleOverrideUntil ?? null,
    overrideActive: false,
  });
};
