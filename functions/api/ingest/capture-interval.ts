// Read-only counterpart to ./weather.ts's write path - GET
// /api/ingest/capture-interval, same per-tenant Bearer API key auth
// (resolveApiKey) as that file, deliberately NOT requireDeveloper/a
// BetterAuth session: the actual caller is the ATC PC2 capture script
// (via worker/src/index.ts's new handleGetCaptureInterval, which proxies
// this using the same SHOBDON_INGEST_KEY it already holds for writes),
// a headless script that fundamentally cannot hold a browser session
// cookie. Lets that script pull its own live captureIntervalSeconds
// setting (ops_panel_state, migration 0080) without ever needing one.
import { resolveApiKey } from "../_utils/apiKeys";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get("authorization") || "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!rawKey) return jsonResponse({ error: "Missing Authorization: Bearer <api key> header" }, 401);

  const keyLookup = await resolveApiKey(env.DB, rawKey);
  if (!keyLookup) return jsonResponse({ error: "Invalid or revoked API key" }, 401);

  // tenant_api_keys.tenant_id is the numeric tenants.id (see
  // weather.ts's own comment on this same key's security boundary) -
  // ops_panel_state is keyed by the separate string organizationId, so
  // that column resolves the one to the other. Both live on the same
  // tenants row (confirmed directly against D1: id=1 <-> organization_id
  // ='org_shobdon'), not two different tables.
  const tenantRow = await env.DB
    .prepare("SELECT organization_id AS organizationId FROM tenants WHERE id = ?")
    .bind(keyLookup.tenantId)
    .first<{ organizationId: string }>();
  if (!tenantRow) return jsonResponse({ error: "Tenant not found" }, 404);

  const row = await env.DB
    .prepare("SELECT captureIntervalSeconds FROM ops_panel_state WHERE organizationId = ?")
    .bind(tenantRow.organizationId)
    .first<{ captureIntervalSeconds: number | null }>();

  return jsonResponse({ captureIntervalSeconds: row?.captureIntervalSeconds ?? 60 });
};
