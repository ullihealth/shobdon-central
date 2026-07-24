// Public, UNAUTHENTICATED read of a tenant's latest ingested weather
// observation (weather_observations/latest_conditions, written by
// functions/api/ingest/weather.ts) - GET /api/public/weather-latest.
// Host-resolved tenant, same pattern as functions/api/public/config.ts.
//
// This is a NEW read path into D1's weather tables. The three existing
// client-side weather providers (src/services/weatherProviders/ -
// 'atc', 'internet', 'mock') never touch D1 at all: 'atc' reads the
// separate KV capture-ingest Worker, 'internet' calls Open-Meteo
// directly, 'mock' is a static constant. Without this endpoint (and the
// 'ingested' provider that consumes it, weatherProviders/
// ingestedProvider.ts), data written by the generic ingestion endpoint
// would never actually appear on any tenant's dashboard - confirmed by
// tracing that read path before building any of this.
//
// Resolves the EFFECTIVE source tenant via tenant_weather_shares
// (migration 0029): if this tenant has an active incoming share, reads
// the SOURCE tenant's latest_conditions instead of its own - e.g. the
// gliding club (target) displaying Shobdon's (source) station data. No
// share -> reads its own data, the ordinary case.

import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface LatestRow {
  observedAt: string;
  windSpeedKt: number | null;
  windDirDeg: number | null;
  windGustKt: number | null;
  qnhHpa: number | null;
  tempC: number | null;
  dewpointC: number | null;
  sourceType: string;
  notamsJson: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const shareRow = await env.DB
    .prepare("SELECT source_tenant_id AS sourceTenantId FROM tenant_weather_shares WHERE target_tenant_id = ?")
    .bind(tenant.id)
    .first<{ sourceTenantId: number }>();
  const effectiveTenantId = shareRow?.sourceTenantId ?? tenant.id;

  const row = await env.DB
    .prepare(
      `SELECT wo.observed_at AS observedAt, wo.wind_speed_kt AS windSpeedKt, wo.wind_dir_deg AS windDirDeg,
              wo.wind_gust_kt AS windGustKt, wo.qnh_hpa AS qnhHpa, wo.temp_c AS tempC, wo.dewpoint_c AS dewpointC,
              wo.source_type AS sourceType, wo.notams_json AS notamsJson
       FROM latest_conditions lc
       JOIN weather_observations wo ON wo.id = lc.observation_id
       WHERE lc.tenant_id = ?`
    )
    .bind(effectiveTenantId)
    .first<LatestRow>();

  if (!row) return jsonResponse(null, 404);

  // notams_json predates migration 0045 for any row backfilled/seeded
  // before it existed (defaults to '[]', but parse defensively anyway -
  // same "don't trust a stored JSON blob is well-formed" posture this
  // project already applies to every other *_json column).
  let notams: string[] = [];
  try {
    const parsed = JSON.parse(row.notamsJson);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) notams = parsed;
  } catch {
    // Leave notams as [] - a malformed blob isn't a reason to 500 the
    // whole reading.
  }

  return jsonResponse({
    observedAt: row.observedAt,
    windSpeedKt: row.windSpeedKt,
    windDirDeg: row.windDirDeg,
    windGustKt: row.windGustKt,
    qnhHpa: row.qnhHpa,
    tempC: row.tempC,
    dewpointC: row.dewpointC,
    sourceType: row.sourceType,
    notams,
  });
};
