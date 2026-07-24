// Generic, vendor-agnostic weather ingestion - POST /api/ingest/weather.
// Authenticated via a per-tenant API key (Authorization: Bearer <key>,
// migration 0029's tenant_api_keys), NOT a BetterAuth session cookie -
// this is machine-to-machine (a weather station's own relay/script),
// never a logged-in browser. Writes into weather_observations tagged
// with the key's own tenant_id and the request's source_type, then
// upserts latest_conditions the same way migration 0023/0026's
// seed/backfill logic already shaped that table.
//
// tenantId is ALWAYS resolved from the API key itself (resolveApiKey),
// never from anything in the request body - there is no "tenantId"
// field this endpoint reads at all. That's the entire security boundary
// a key issued for one tenant cannot write data tagged to a different
// tenant under any circumstance, because there's no code path that ever
// asks the caller which tenant to write to.
//
// Additive only - does not touch or replace the existing ATC PC2 -> KV
// capture-ingest Worker pipeline (worker/src/index.ts), which keeps
// writing to KV exactly as it always has. This is a wholly separate,
// new path into D1 for any OTHER station vendor or third-party feed.

import { resolveApiKey } from "../_utils/apiKeys";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ success: boolean }>;
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

const ALLOWED_SOURCE_TYPES = ["atc_capture", "internet", "third_party_api"];

interface IngestBody {
  sourceType?: unknown;
  observedAt?: unknown;
  windSpeedKt?: unknown;
  windDirDeg?: unknown;
  windGustKt?: unknown;
  qnhHpa?: unknown;
  tempC?: unknown;
  dewpointC?: unknown;
  visibilityM?: unknown;
  rawSnapshotId?: unknown;
  // Optional - a source with no NOTAMs concept at all (most third-party
  // vendor APIs) simply omits this, stored as '[]'. See migration 0045's
  // own comment for why this was missing entirely until now.
  notams?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Anything not cleanly a string[] is treated as "no notams" rather than
// rejecting the whole ingest - matches atcProvider.ts's own
// stringArrayField leniency for the exact same data shape.
function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get("authorization") || "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!rawKey) return jsonResponse({ error: "Missing Authorization: Bearer <api key> header" }, 401);

  const keyLookup = await resolveApiKey(env.DB, rawKey);
  if (!keyLookup) return jsonResponse({ error: "Invalid or revoked API key" }, 401);

  const body = (await request.json().catch(() => null)) as IngestBody | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const sourceType = typeof body.sourceType === "string" && ALLOWED_SOURCE_TYPES.includes(body.sourceType) ? body.sourceType : null;
  if (!sourceType) return jsonResponse({ error: `sourceType must be one of: ${ALLOWED_SOURCE_TYPES.join(", ")}` }, 400);

  const observedAt = typeof body.observedAt === "string" && !Number.isNaN(Date.parse(body.observedAt)) ? body.observedAt : null;
  if (!observedAt) return jsonResponse({ error: "observedAt must be a valid ISO timestamp" }, 400);

  const windSpeedKt = numberOrNull(body.windSpeedKt);
  const windDirDeg = numberOrNull(body.windDirDeg);
  const qnhHpa = numberOrNull(body.qnhHpa);
  const tempC = numberOrNull(body.tempC);
  if (windSpeedKt === null || windDirDeg === null || qnhHpa === null || tempC === null) {
    return jsonResponse({ error: "windSpeedKt, windDirDeg, qnhHpa, and tempC are required numeric fields" }, 400);
  }
  const windGustKt = numberOrNull(body.windGustKt);
  const dewpointC = numberOrNull(body.dewpointC);
  const visibilityM = numberOrNull(body.visibilityM);
  const rawSnapshotId = typeof body.rawSnapshotId === "string" ? body.rawSnapshotId : null;
  const notams = stringArrayOrEmpty(body.notams);

  const { tenantId } = keyLookup;

  const insertResult = await env.DB
    .prepare(
      `INSERT INTO weather_observations
         (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, raw_snapshot_id, source_type, notams_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(tenantId, observedAt, windSpeedKt, windDirDeg, windGustKt, qnhHpa, tempC, dewpointC, visibilityM, rawSnapshotId, sourceType, JSON.stringify(notams))
    .run();

  if (!insertResult.success) return jsonResponse({ error: "Failed to store observation" }, 500);

  const inserted = await env.DB
    .prepare("SELECT id FROM weather_observations WHERE tenant_id = ? ORDER BY id DESC LIMIT 1")
    .bind(tenantId)
    .first<{ id: number }>();

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `INSERT INTO latest_conditions (tenant_id, observation_id, last_updated_at, expected_interval_min, is_stale)
       VALUES (?, ?, ?, 10, 0)
       ON CONFLICT(tenant_id) DO UPDATE SET
         observation_id = excluded.observation_id,
         last_updated_at = excluded.last_updated_at,
         is_stale = 0`
    )
    .bind(tenantId, inserted?.id ?? null, now)
    .run();

  await env.DB.prepare("UPDATE tenant_api_keys SET last_used_at = ? WHERE id = ?").bind(now, keyLookup.id).run();

  return jsonResponse({ ok: true, sourceType, observedAt });
};
