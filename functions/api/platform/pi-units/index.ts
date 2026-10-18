// Platform-admin only: GET/POST /api/platform/pi-units - the Pi Fleet
// inventory (migration 0098). Backs /platform/pi-fleet
// (src/pages/PlatformPiFleetPage.tsx). requirePlatformAdmin remains the
// ONLY gate on every route in this file - Pi Fleet itself stays
// developer-only, same reasoning as tenants/index.ts's own comment
// (org-independent by design, since a Pi unit's tenant_name is plain
// free text, not a real tenant link - see the migration's own comment
// for why).
//
// Tenant-facing TV schedule round (migration 0115) - a deliberate,
// narrow exception to the "no tenant-facing surface" premise above:
// pi_units.tenant_id is now a real, nullable link a platform admin sets
// explicitly here (the "Linked tenant" picker on the Pi Fleet card).
// Tenant-facing access exists ONLY for a box with tenant_id actually
// set - see functions/api/tenant/tv-schedule/*.ts, which are the only
// other routes that ever read/write pi_units at all, and which check
// THIS column (never tenant_name) as their real security boundary.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface PiUnitRow {
  id: number;
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
  createdAt: string;
  updatedAt: string;
  // TV wake/sleep schedule round (migration 0114) - see
  // [id]/tv-schedule-override.ts's own comment for the override fields.
  tvScheduleEnabled: number;
  tvScheduleJson: string | null;
  tvScheduleOverrideState: string | null;
  tvScheduleOverrideUntil: string | null;
  tvScheduleLastSeenAt: string | null;
  tvScheduleLastCommand: string | null;
  tvScheduleLastCommandAt: string | null;
  tvScheduleLastError: string | null;
  // Tenant-facing TV schedule round (migration 0115).
  tenantId: number | null;
  linkedTenantName: string | null;
}

interface PiUnitNoteRow {
  id: number;
  piUnitId: number;
  noteText: string;
  createdAt: string;
}

const UNIT_COLUMNS = `id, serial_number AS serialNumber, tenant_name AS tenantName, physical_address AS physicalAddress,
   contact_name AS contactName, contact_email AS contactEmail, contact_phone AS contactPhone,
   wifi_network_name AS wifiNetworkName, date_issued AS dateIssued, hostname, dashboard_url AS dashboardUrl,
   master_image_version AS masterImageVersion, image_source_link AS imageSourceLink, status,
   created_at AS createdAt, updated_at AS updatedAt,
   tv_schedule_enabled AS tvScheduleEnabled, tv_schedule_json AS tvScheduleJson,
   tv_schedule_override_state AS tvScheduleOverrideState, tv_schedule_override_until AS tvScheduleOverrideUntil,
   tv_schedule_last_seen_at AS tvScheduleLastSeenAt, tv_schedule_last_command AS tvScheduleLastCommand,
   tv_schedule_last_command_at AS tvScheduleLastCommandAt, tv_schedule_last_error AS tvScheduleLastError,
   tenant_id AS tenantId`;

export const STATUS_OPTIONS = ["active", "spare", "faulty", "retired"] as const;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  // Same N+1-avoidance shape as tenants/index.ts's own historyByTenant -
  // one query for every unit, one for every note (newest-first, matching
  // the notes log's own reverse-chronological display), grouped into a
  // Map by pi_unit_id rather than a per-unit round trip.
  // Tenant-facing TV schedule round - a plain id->name Map rather than a
  // JOIN in UNIT_COLUMNS, so that one shared column list stays safe to
  // reuse everywhere it already is (POST's own single-row SELECT below,
  // [id].ts's PATCH) without needing a join at every call site. The
  // tenants table is small; fetching every id+name is cheap next to the
  // per-unit/per-note queries already running here.
  const [{ results: units }, { results: noteRows }, { results: tenantRows }] = await Promise.all([
    env.DB.prepare(`SELECT ${UNIT_COLUMNS} FROM pi_units ORDER BY updated_at DESC`).all<PiUnitRow>(),
    env.DB
      .prepare(
        `SELECT id, pi_unit_id AS piUnitId, note_text AS noteText, created_at AS createdAt
         FROM pi_unit_notes ORDER BY created_at DESC`
      )
      .all<PiUnitNoteRow>(),
    env.DB.prepare(`SELECT id, name FROM tenants WHERE deleted_at IS NULL ORDER BY name`).all<{ id: number; name: string }>(),
  ]);

  const notesByUnit = new Map<number, PiUnitNoteRow[]>();
  for (const row of noteRows) {
    const list = notesByUnit.get(row.piUnitId) ?? [];
    list.push(row);
    notesByUnit.set(row.piUnitId, list);
  }
  const tenantNameById = new Map(tenantRows.map((t) => [t.id, t.name]));

  const now = Date.now();

  return jsonResponse({
    units: units.map((unit) => ({
      ...unit,
      linkedTenantName: unit.tenantId != null ? (tenantNameById.get(unit.tenantId) ?? null) : null,
      tvScheduleEnabled: !!unit.tvScheduleEnabled,
      tvSchedule: unit.tvScheduleJson ? JSON.parse(unit.tvScheduleJson) : null,
      // Display convenience only - the real expiry/clearing happens
      // server-side on the box's own poll check-in (functions/api/
      // public/pi-units/tv-schedule.ts), which lazily clears a stale
      // override in D1 the next time the box actually checks in. This
      // flag just lets the card show "active until HH:MM" vs. nothing
      // without the admin needing to wait for that next poll first.
      tvScheduleOverrideActive: !!(unit.tvScheduleOverrideUntil && new Date(unit.tvScheduleOverrideUntil).getTime() > now),
      notes: (notesByUnit.get(unit.id) ?? []).map((note) => ({
        id: note.id,
        noteText: note.noteText,
        createdAt: note.createdAt,
      })),
    })),
    // Options for the "Linked tenant" picker - returned alongside the
    // units themselves (not a separate /api/platform/tenants fetch) so
    // this one already-admin-gated call is self-contained.
    tenants: tenantRows,
  });
};

interface CreateBody {
  serialNumber?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = await request.json<CreateBody>().catch(() => null);
  const serialNumber = body?.serialNumber?.trim();
  if (!serialNumber) return jsonResponse({ error: "serialNumber is required" }, 400);

  const now = new Date().toISOString();

  try {
    await env.DB
      .prepare(`INSERT INTO pi_units (serial_number, status, created_at, updated_at) VALUES (?, 'spare', ?, ?)`)
      .bind(serialNumber, now, now)
      .run();
  } catch (error) {
    // UNIQUE constraint on serial_number is the only way this insert can
    // fail - every other column is nullable/defaulted. Reported as a
    // normal 409, not a 500, since a duplicate serial is an operator
    // mistake (typo, reusing a card), not a real server error.
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({ error: `A Pi unit with serial number "${serialNumber}" already exists` }, 409);
    }
    throw error;
  }

  // serial_number is UNIQUE, so it reliably identifies the row just
  // inserted above - same "insert, then look the row back up rather
  // than relying on a returned row id" shape runWeatherFallbackCheck
  // (worker/src/index.ts) already uses for the same local D1Database
  // type, which doesn't type last_row_id on a plain .run() result.
  const created = await env.DB
    .prepare(`SELECT ${UNIT_COLUMNS} FROM pi_units WHERE serial_number = ?`)
    .bind(serialNumber)
    .first<PiUnitRow>();
  return jsonResponse(
    { ...created, linkedTenantName: null, tvScheduleEnabled: false, tvSchedule: null, tvScheduleOverrideActive: false, notes: [] },
    201
  );
};
