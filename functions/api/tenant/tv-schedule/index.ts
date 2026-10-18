// Owner/admin only: GET /api/tenant/tv-schedule - lists the caller's own
// tenant's linked Pi box(es) and their TV wake/sleep schedule state.
// Tenant-facing TV schedule round (migration 0115) - the ONE place a
// tenant reaches into pi_units at all, and it does so strictly through
// the real `tenant_id` link that migration adds, NEVER the free-text
// `tenant_name` column Pi Fleet itself uses (see that migration's own
// comment - tenant_name stays exactly as it was, deliberately untouched
// by this round).
//
// requireOwner (owner/admin), same gate as Weather Config
// (functions/api/tenant/config.ts) - this is plumbing/hardware-adjacent
// settings, not something every member role should be able to touch.
//
// Field exposure is deliberately narrow - this response (and every
// other route in this directory) returns ONLY: box id (needed to
// address the PATCH/override routes below - not sensitive on its own),
// serial number, enabled, schedule, override state, and last-seen. It
// NEVER returns hostname, physical address, WiFi name, contact details,
// image info, or PI_FLEET_KEY (which isn't even stored in D1 - see the
// public poll route's own comment) - all Pi-Fleet-only fields a tenant
// has no reason to see.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface BoxRow {
  id: number;
  serialNumber: string;
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
  tvScheduleOverrideState: string | null;
  tvScheduleOverrideUntil: string | null;
  tvScheduleLastSeenAt: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  const tenantRow = await env.DB
    .prepare("SELECT id FROM tenants WHERE organization_id = ?")
    .bind(result.membership.organizationId)
    .first<{ id: number }>();
  if (!tenantRow) return jsonResponse({ error: "Tenant not found" }, 404);

  const { results: boxes } = await env.DB
    .prepare(
      `SELECT id, serial_number AS serialNumber, tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson,
              tv_schedule_override_state AS tvScheduleOverrideState, tv_schedule_override_until AS tvScheduleOverrideUntil,
              tv_schedule_last_seen_at AS tvScheduleLastSeenAt
       FROM pi_units WHERE tenant_id = ? ORDER BY id`
    )
    .bind(tenantRow.id)
    .all<BoxRow>();

  const now = Date.now();
  return jsonResponse({
    boxes: boxes.map((box) => ({
      id: box.id,
      serialNumber: box.serialNumber,
      enabled: !!box.tvScheduleEnabled,
      schedule: box.tvScheduleJson ? JSON.parse(box.tvScheduleJson) : null,
      overrideState: box.tvScheduleOverrideState,
      overrideUntil: box.tvScheduleOverrideUntil,
      overrideActive: !!(box.tvScheduleOverrideUntil && new Date(box.tvScheduleOverrideUntil).getTime() > now),
      lastSeenAt: box.tvScheduleLastSeenAt,
    })),
  });
};
