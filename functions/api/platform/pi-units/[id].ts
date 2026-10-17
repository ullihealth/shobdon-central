// Platform-admin only: PATCH /api/platform/pi-units/:id - partial update
// of a single Pi unit's fields. Same "fetch current row, merge only the
// fields present in the body via ?? (or !== undefined for nullable
// fields a caller can deliberately clear), write everything back" shape
// as tenants/[id].ts's own PATCH - reused deliberately rather than
// inventing a second update convention.
//
// Deliberately does NOT touch pi_unit_notes - adding a note is its own
// action (POST :id/notes), not a side effect of editing another field,
// unlike tenants/[id].ts's subscription_history insert. A notes log is
// an explicit CRM activity entry, not a byproduct of some other change.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { validateSchedule } from "../../_utils/tvSchedule.mjs";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface PiUnitRow {
  serialNumber: string;
  tenantName: string | null;
  physicalAddress: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  wifiNetworkName: string | null;
  dateIssued: string | null;
  hostname: string | null;
  dashboardUrl: string | null;
  masterImageVersion: string | null;
  imageSourceLink: string | null;
  status: string;
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
}

interface PatchBody {
  serialNumber?: string;
  tenantName?: string | null;
  physicalAddress?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  wifiNetworkName?: string | null;
  dateIssued?: string | null;
  hostname?: string | null;
  dashboardUrl?: string | null;
  masterImageVersion?: string | null;
  imageSourceLink?: string | null;
  status?: string;
  // TV wake/sleep schedule round (migration 0114) - the Pi Fleet card's
  // own "Save" button sends both together always (see
  // PlatformPiFleetPage.tsx's own comment), but each is still read via
  // `!== undefined` below, not `??`, so a direct PATCH call touching only
  // one of them (e.g. a future bulk "disable all" action) is possible
  // without silently clobbering the other - same nullable-field
  // reasoning as every other field on this route.
  tvScheduleEnabled?: boolean;
  tvSchedule?: Record<string, { wake: string; sleep: string; off: boolean }> | null;
}

const STATUS_OPTIONS = ["active", "spare", "faulty", "retired"] as const;

const UNIT_COLUMNS = `id, serial_number AS serialNumber, tenant_name AS tenantName, physical_address AS physicalAddress,
   contact_name AS contactName, contact_email AS contactEmail, contact_phone AS contactPhone,
   wifi_network_name AS wifiNetworkName, date_issued AS dateIssued, hostname, dashboard_url AS dashboardUrl,
   master_image_version AS masterImageVersion, image_source_link AS imageSourceLink, status,
   created_at AS createdAt, updated_at AS updatedAt,
   tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson,
   tv_schedule_override_state AS tvScheduleOverrideState, tv_schedule_override_until AS tvScheduleOverrideUntil,
   tv_schedule_last_seen_at AS tvScheduleLastSeenAt, tv_schedule_last_command AS tvScheduleLastCommand,
   tv_schedule_last_command_at AS tvScheduleLastCommandAt, tv_schedule_last_error AS tvScheduleLastError`;

// Nullable free-text fields: an omitted field (undefined) means "no
// change"; an explicitly-sent empty string means "clear it" (a plain
// text input cleared by the operator) - both collapse to null in the
// DB, distinguished from omission via `!== undefined`, same reasoning
// as tenants/[id].ts's own qnhQfeOffsetHpa/qrMockupR2Key handling.
function nextNullable(value: string | null | undefined, current: string | null): string | null {
  if (value === undefined) return current;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const unitId = Number(params.id);
  if (!Number.isFinite(unitId)) return jsonResponse({ error: "Invalid unit id" }, 400);

  const body = await request.json<PatchBody>().catch(() => null);
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  if (body.status !== undefined && !STATUS_OPTIONS.includes(body.status as (typeof STATUS_OPTIONS)[number])) {
    return jsonResponse({ error: `status must be one of: ${STATUS_OPTIONS.join(", ")}` }, 400);
  }
  if (body.tvScheduleEnabled !== undefined && typeof body.tvScheduleEnabled !== "boolean") {
    return jsonResponse({ error: "tvScheduleEnabled must be a boolean" }, 400);
  }
  if (body.tvSchedule !== undefined && body.tvSchedule !== null) {
    const scheduleError = validateSchedule(body.tvSchedule);
    if (scheduleError) return jsonResponse({ error: scheduleError }, 400);
  }

  const current = await env.DB.prepare(`SELECT ${UNIT_COLUMNS} FROM pi_units WHERE id = ?`).bind(unitId).first<PiUnitRow>();
  if (!current) return jsonResponse({ error: "Pi unit not found" }, 404);

  const serialNumber = body.serialNumber !== undefined ? body.serialNumber.trim() : current.serialNumber;
  if (!serialNumber) return jsonResponse({ error: "serialNumber cannot be empty" }, 400);

  // Can't enable a schedule with nothing configured - the resulting
  // tv_schedule_json would be NULL and computeDesiredState() (box side
  // and override side alike) already treats "enabled but no schedule" as
  // "do nothing", so this would silently no-op forever rather than fail
  // loudly - reject it here instead, at the one place a caller could
  // create that state.
  const nextTvScheduleEnabled = body.tvScheduleEnabled ?? !!current.tvScheduleEnabled;
  const nextTvScheduleJsonRaw = body.tvSchedule !== undefined ? (body.tvSchedule === null ? null : JSON.stringify(body.tvSchedule)) : current.tvScheduleJson;
  if (nextTvScheduleEnabled && !nextTvScheduleJsonRaw) {
    return jsonResponse({ error: "Cannot enable the TV schedule without a saved schedule" }, 400);
  }

  const next = {
    serialNumber,
    tenantName: nextNullable(body.tenantName, current.tenantName),
    physicalAddress: nextNullable(body.physicalAddress, current.physicalAddress),
    contactName: nextNullable(body.contactName, current.contactName),
    contactEmail: nextNullable(body.contactEmail, current.contactEmail),
    contactPhone: nextNullable(body.contactPhone, current.contactPhone),
    wifiNetworkName: nextNullable(body.wifiNetworkName, current.wifiNetworkName),
    dateIssued: nextNullable(body.dateIssued, current.dateIssued),
    hostname: nextNullable(body.hostname, current.hostname),
    dashboardUrl: nextNullable(body.dashboardUrl, current.dashboardUrl),
    masterImageVersion: nextNullable(body.masterImageVersion, current.masterImageVersion),
    imageSourceLink: nextNullable(body.imageSourceLink, current.imageSourceLink),
    status: body.status ?? current.status,
    tvScheduleEnabled: nextTvScheduleEnabled,
    tvScheduleJson: nextTvScheduleJsonRaw,
  };

  try {
    await env.DB
      .prepare(
        `UPDATE pi_units SET serial_number = ?, tenant_name = ?, physical_address = ?, contact_name = ?, contact_email = ?,
                contact_phone = ?, wifi_network_name = ?, date_issued = ?, hostname = ?, dashboard_url = ?,
                master_image_version = ?, image_source_link = ?, status = ?,
                tv_schedule_enabled = ?, tv_schedule_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        next.serialNumber,
        next.tenantName,
        next.physicalAddress,
        next.contactName,
        next.contactEmail,
        next.contactPhone,
        next.wifiNetworkName,
        next.dateIssued,
        next.hostname,
        next.dashboardUrl,
        next.masterImageVersion,
        next.imageSourceLink,
        next.status,
        next.tvScheduleEnabled ? 1 : 0,
        next.tvScheduleJson,
        new Date().toISOString(),
        unitId
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({ error: `A Pi unit with serial number "${next.serialNumber}" already exists` }, 409);
    }
    throw error;
  }

  const updated = await env.DB.prepare(`SELECT ${UNIT_COLUMNS} FROM pi_units WHERE id = ?`).bind(unitId).first<Record<string, unknown>>();
  const nowMs = Date.now();
  const overrideUntil = updated?.tvScheduleOverrideUntil as string | null;
  return jsonResponse({
    ...updated,
    tvScheduleEnabled: !!updated?.tvScheduleEnabled,
    tvSchedule: updated?.tvScheduleJson ? JSON.parse(updated.tvScheduleJson as string) : null,
    tvScheduleOverrideActive: !!(overrideUntil && new Date(overrideUntil).getTime() > nowMs),
  });
};
