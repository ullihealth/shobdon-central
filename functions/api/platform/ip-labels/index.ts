// Platform-admin only: GET/POST /api/platform/ip-labels - the global,
// NOT tenant-scoped IP directory (migration 0057). GET backs both the
// Visit Log's per-row label lookup and the group-name autocomplete on
// the labeling input; POST is a single-action upsert (typing a new
// group_name creates it, typing an existing one just adds this IP to
// it - no separate "create group" step).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface IpLabelRow {
  id: number;
  ipAddress: string;
  groupName: string;
  note: string | null;
  // Migration 0058 - a fixed-palette key (e.g. "sky"), NOT a raw hex
  // value; see src/utils/labelColors.ts for the actual palette and the
  // deterministic hash-to-colour fallback used when this is NULL.
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const { results } = await env.DB
    .prepare(
      `SELECT id, ip_address AS ipAddress, group_name AS groupName, note, color, created_at AS createdAt, updated_at AS updatedAt
       FROM ip_labels
       ORDER BY group_name, ip_address`
    )
    .all<IpLabelRow>();

  return jsonResponse({ labels: results });
};

interface UpsertBody {
  ipAddress?: unknown;
  groupName?: unknown;
  note?: unknown;
  color?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as UpsertBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const ipAddress = typeof body.ipAddress === "string" ? body.ipAddress.trim() : "";
  const groupName = typeof body.groupName === "string" ? body.groupName.trim() : "";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  // Trusts the frontend to only ever send a real palette key or omit
  // this entirely - same posture as every other free-text field here,
  // and an unrecognised key just falls back to the hash-derived colour
  // (resolveLabelColor's own behaviour), never a broken render.
  const color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : null;

  if (!ipAddress) return jsonResponse({ error: "ipAddress is required" }, 400);
  if (!groupName) return jsonResponse({ error: "groupName is required" }, 400);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO ip_labels (ip_address, group_name, note, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ip_address) DO UPDATE SET
         group_name = excluded.group_name,
         note = excluded.note,
         color = excluded.color,
         updated_at = excluded.updated_at`
    )
    .bind(ipAddress, groupName, note, color, now, now)
    .run();

  return jsonResponse({ ok: true });
};
