// Platform-admin only: GET/POST /api/platform/known-devices[?tenantId=&displaySlug=] -
// the confirmed/dismissed decisions backing both the suggestion-review UI
// (excluding already-decided IPs, see suggestions.ts) and Phase C's uptime
// report (which only counts visits from status='confirmed', active=1 rows).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface KnownDeviceRow {
  id: number;
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  displaySlug: string;
  ipAddress: string;
  label: string | null;
  status: string;
  active: number;
  confirmedAt: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const displaySlugParam = url.searchParams.get("displaySlug");

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (tenantIdParam) {
    const tenantId = Number(tenantIdParam);
    if (Number.isFinite(tenantId)) {
      conditions.push("k.tenant_id = ?");
      bindings.push(tenantId);
    }
  }
  if (displaySlugParam) {
    conditions.push("k.display_slug = ?");
    bindings.push(displaySlugParam);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await env.DB
    .prepare(
      `SELECT k.id AS id, k.tenant_id AS tenantId, t.name AS tenantName, t.slug AS tenantSlug,
              k.display_slug AS displaySlug, k.ip_address AS ipAddress, k.label AS label,
              k.status AS status, k.active AS active, k.confirmed_at AS confirmedAt
       FROM tenant_known_devices k
       JOIN tenants t ON t.id = k.tenant_id
       ${whereClause}
       ORDER BY k.active DESC, k.confirmed_at DESC`
    )
    .bind(...bindings)
    .all<KnownDeviceRow>();

  return jsonResponse({ knownDevices: results });
};

interface ConfirmBody {
  tenantId?: unknown;
  displaySlug?: unknown;
  ipAddress?: unknown;
  label?: unknown;
  status?: unknown;
}

// Confirms or dismisses a suggested IP - both are "a decision has been
// made about this IP" (see migration 0056's own comment on why both
// need to stop being re-suggested). Upserts on the table's own
// UNIQUE(tenant_id, display_slug, ip_address) - re-deciding an IP
// (e.g. dismissed by mistake, now confirming it) updates the existing
// row rather than erroring or duplicating.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as ConfirmBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const tenantId = Number(body.tenantId);
  const displaySlug = typeof body.displaySlug === "string" ? body.displaySlug.trim() : "";
  const ipAddress = typeof body.ipAddress === "string" ? body.ipAddress.trim() : "";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
  const status = body.status === "dismissed" ? "dismissed" : "confirmed";

  if (!Number.isFinite(tenantId)) return jsonResponse({ error: "tenantId must be a number" }, 400);
  if (!displaySlug) return jsonResponse({ error: "displaySlug is required" }, 400);
  if (!ipAddress) return jsonResponse({ error: "ipAddress is required" }, 400);

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO tenant_known_devices (tenant_id, display_slug, ip_address, label, status, active, confirmed_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(tenant_id, display_slug, ip_address) DO UPDATE SET
         label = excluded.label,
         status = excluded.status,
         active = 1,
         confirmed_at = excluded.confirmed_at`
    )
    .bind(tenantId, displaySlug, ipAddress, label, status, now)
    .run();

  return jsonResponse({ ok: true });
};
