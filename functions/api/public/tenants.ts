// Public, UNAUTHENTICATED cross-tenant listing - Stage 4's "query path
// gated by weather_public/ops_public" (the data API Stage 5's not-yet-
// built global landing page will eventually consume). Inherently cross-
// tenant, unlike every other functions/api/public/* route, which is why
// there's no Host-based or :tenant-based resolution here at all - it's
// not asking "which tenant am I", it's "which tenants have opted in".
//
// GET /api/public/tenants -> array of active tenants with weather_public
// or ops_public set, each including only whichever of weather/ops that
// specific tenant has actually opted into (the two flags are
// independent - a tenant can publish one without the other). A tenant
// with both flags 0 (Shobdon, today) simply doesn't appear at all -
// this endpoint is genuinely inert (returns []) until an owner opts in
// via PUT /api/tenant/public-visibility.
//
// is_internal (0026_demo_template_tenant.sql) is a SEPARATE flag from
// weather_public/ops_public, checked here unconditionally - internal/
// template tenants (e.g. the 'demo' tenant used for marketing
// screenshots) must never appear in this listing, even if
// weather_public/ops_public ever get flipped on by mistake while
// populating sample data. Only this WHERE clause enforces that; there's
// no separate admin-only listing to also update.
//
// Does not touch or affect functions/api/public/config.ts /
// visibility-forecast.ts (Stage 3's per-tenant dashboard reads) or any
// organizationId-scoped table (camera_slots/carousel_slots/etc.) - this
// only ever reads the tenants/weather_observations/latest_conditions/
// operational_events tables from Stage 2.
//
// loadWeather/loadActiveOps resolve through resolveEffectiveTenantById
// (same helper weather-latest.ts/notams.ts already use) before querying
// latest_conditions/weather_observations/operational_events - those
// tables are keyed by tenants.id, and a linked sub-tenant (migration
// 0059, tenants.parent_tenant_id) has none of its own rows there, only
// its parent's. Missed when parent-tenant linking landed; this file was
// never updated to match the pattern until now.

import { resolveEffectiveTenantById } from "../_utils/resolveParentTenant";

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = unknown>() => Promise<{ results: T[] }>;
    };
    all: <T = unknown>() => Promise<{ results: T[] }>;
  };
};

type PagesFunction<Env = unknown> = (context: { env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantRow {
  id: number;
  slug: string;
  name: string;
  subdomain: string;
  icao_code: string | null;
  lat: number | null;
  lon: number | null;
  weather_public: number;
  ops_public: number;
  global_link_enabled: number;
}

interface LatestConditionsRow {
  lastUpdatedAt: string;
  expectedIntervalMin: number;
  observedAt: string | null;
  windSpeedKt: number | null;
  windDirDeg: number | null;
  windGustKt: number | null;
  qnhHpa: number | null;
  tempC: number | null;
  dewpointC: number | null;
  visibilityM: number | null;
  runway: string | null;
  runwayHand: string | null;
}

interface OperationalEventRow {
  id: number;
  category: string;
  severity: string;
  message: string;
  startsAt: string;
  expiresAt: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function loadWeather(tenantId: number, db: D1Database) {
  const effective = await resolveEffectiveTenantById(db, tenantId);
  const row = await db
    .prepare(
      `SELECT
         lc.last_updated_at AS lastUpdatedAt,
         lc.expected_interval_min AS expectedIntervalMin,
         wo.observed_at AS observedAt,
         wo.wind_speed_kt AS windSpeedKt,
         wo.wind_dir_deg AS windDirDeg,
         wo.wind_gust_kt AS windGustKt,
         wo.qnh_hpa AS qnhHpa,
         wo.temp_c AS tempC,
         wo.dewpoint_c AS dewpointC,
         wo.visibility_m AS visibilityM,
         wo.runway AS runway,
         wo.runway_hand AS runwayHand
       FROM latest_conditions lc
       LEFT JOIN weather_observations wo ON wo.id = lc.observation_id
       WHERE lc.tenant_id = ?`
    )
    .bind(effective.id)
    .first<LatestConditionsRow>();

  if (!row) return null;

  // is_stale is a plain stored column (D1 rejects non-deterministic
  // generated columns - see 0022_tenant_schema.sql's pre-flight
  // finding), and nothing currently re-writes it on a schedule - trust
  // is computed fresh here at read time instead, per that migration's
  // own documented intent, rather than whatever's sitting in the column.
  const isStale = Date.now() - Date.parse(row.lastUpdatedAt) > row.expectedIntervalMin * 60_000;

  return {
    observedAt: row.observedAt,
    windSpeedKt: row.windSpeedKt,
    windDirDeg: row.windDirDeg,
    windGustKt: row.windGustKt,
    qnhHpa: row.qnhHpa,
    tempC: row.tempC,
    dewpointC: row.dewpointC,
    visibilityM: row.visibilityM,
    runway: row.runway,
    runwayHand: row.runwayHand,
    lastUpdatedAt: row.lastUpdatedAt,
    isStale,
  };
}

async function loadActiveOps(tenantId: number, db: D1Database) {
  const effective = await resolveEffectiveTenantById(db, tenantId);
  const rows = await db
    .prepare(
      "SELECT id, category, severity, message, starts_at AS startsAt, expires_at AS expiresAt FROM operational_events WHERE tenant_id = ? AND status = 'active' ORDER BY starts_at"
    )
    .bind(effective.id)
    .all<OperationalEventRow>();
  return rows.results;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const tenantRows = await env.DB
    .prepare(
      "SELECT id, slug, name, subdomain, icao_code, lat, lon, weather_public, ops_public, global_link_enabled FROM tenants WHERE active = 1 AND is_internal = 0 AND (weather_public = 1 OR ops_public = 1)"
    )
    .all<TenantRow>();

  const tenants = await Promise.all(
    tenantRows.results.map(async (tenant) => {
      const [weather, ops] = await Promise.all([
        tenant.weather_public ? loadWeather(tenant.id, env.DB) : Promise.resolve(undefined),
        tenant.ops_public ? loadActiveOps(tenant.id, env.DB) : Promise.resolve(undefined),
      ]);

      return {
        slug: tenant.slug,
        name: tenant.name,
        subdomain: tenant.subdomain,
        icaoCode: tenant.icao_code,
        lat: tenant.lat,
        lon: tenant.lon,
        globalLinkEnabled: !!tenant.global_link_enabled,
        ...(weather !== undefined ? { weather } : {}),
        ...(ops !== undefined ? { ops } : {}),
      };
    })
  );

  return jsonResponse(tenants);
};
