// Platform-admin only: GET/POST /api/platform/pi-units - the Pi Fleet
// inventory (migration 0098). Backs /platform/pi-fleet
// (src/pages/PlatformPiFleetPage.tsx). No tenant-facing surface, no
// data-isolation concerns - requirePlatformAdmin is the only gate,
// same reasoning as tenants/index.ts's own comment (org-independent by
// design, since a Pi unit's tenant_name is plain free text, not a real
// tenant link - see the migration's own comment for why).
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
   created_at AS createdAt, updated_at AS updatedAt`;

export const STATUS_OPTIONS = ["active", "spare", "faulty", "retired"] as const;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  // Same N+1-avoidance shape as tenants/index.ts's own historyByTenant -
  // one query for every unit, one for every note (newest-first, matching
  // the notes log's own reverse-chronological display), grouped into a
  // Map by pi_unit_id rather than a per-unit round trip.
  const [{ results: units }, { results: noteRows }] = await Promise.all([
    env.DB.prepare(`SELECT ${UNIT_COLUMNS} FROM pi_units ORDER BY updated_at DESC`).all<PiUnitRow>(),
    env.DB
      .prepare(
        `SELECT id, pi_unit_id AS piUnitId, note_text AS noteText, created_at AS createdAt
         FROM pi_unit_notes ORDER BY created_at DESC`
      )
      .all<PiUnitNoteRow>(),
  ]);

  const notesByUnit = new Map<number, PiUnitNoteRow[]>();
  for (const row of noteRows) {
    const list = notesByUnit.get(row.piUnitId) ?? [];
    list.push(row);
    notesByUnit.set(row.piUnitId, list);
  }

  return jsonResponse({
    units: units.map((unit) => ({
      ...unit,
      notes: (notesByUnit.get(unit.id) ?? []).map((note) => ({
        id: note.id,
        noteText: note.noteText,
        createdAt: note.createdAt,
      })),
    })),
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
  return jsonResponse({ ...created, notes: [] }, 201);
};
