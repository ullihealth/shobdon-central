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

// 'met_office_fallback' (platform weather-fallback cron round) - written
// by worker/src/index.ts's scheduled handler on behalf of a
// station-owning ('atc') tenant whose real feed has gone stale,
// distinct from 'internet' (a tenant's own genuine primary source being
// an internet API) so a substituted reading is always auditable/
// distinguishable from a real one. That handler writes directly to D1
// (system-level access, not a per-tenant API key - see its own comment
// for why), so this endpoint itself never actually receives a POST with
// this sourceType in practice today; it's accepted here anyway so the
// validation list stays the single source of truth for every value this
// column can legitimately hold, not just the ones reachable through
// this one endpoint.
const ALLOWED_SOURCE_TYPES = ["atc_capture", "internet", "third_party_api", "met_office_fallback"];

// Physical plausibility bounds - on top of, not instead of, the
// presence/type check below (numberOrNull). That check alone catches a
// missing/malformed field, but does nothing for a numeric-but-garbage
// value (confirmed in practice against Shobdon's own ATC capture: a
// broken source page has produced qnh_hpa=59, physically impossible).
// Applies to every source_type, not just atc_capture - a garbage
// reading from any vendor is equally implausible. Ceilings are
// deliberately generous (never intended to reject genuine extreme
// weather, only obvious garbage). Duplicated in worker/src/index.ts's
// own copy of this same gate - see that file's comment for why
// (deployed as a wholly separate Worker, no shared module to import
// from).
const WIND_DIR_MIN_DEG = 0;
const WIND_DIR_MAX_DEG = 360;
const WIND_SPEED_MIN_KT = 0;
const WIND_SPEED_MAX_KT = 150;
const QNH_MIN_HPA = 900;
const QNH_MAX_HPA = 1050;
const TEMP_MIN_C = -40;
const TEMP_MAX_C = 50;

function isPlausibleReading(windSpeedKt: number, windDirDeg: number, qnhHpa: number, tempC: number): boolean {
  return (
    windDirDeg >= WIND_DIR_MIN_DEG &&
    windDirDeg <= WIND_DIR_MAX_DEG &&
    windSpeedKt >= WIND_SPEED_MIN_KT &&
    windSpeedKt <= WIND_SPEED_MAX_KT &&
    qnhHpa >= QNH_MIN_HPA &&
    qnhHpa <= QNH_MAX_HPA &&
    tempC >= TEMP_MIN_C &&
    tempC <= TEMP_MAX_C
  );
}

interface IngestBody {
  sourceType?: unknown;
  observedAt?: unknown;
  windSpeedKt?: unknown;
  windDirDeg?: unknown;
  windGustKt?: unknown;
  qnhHpa?: unknown;
  // Optional - not every source has QFE (pressure referenced to airfield
  // elevation rather than sea level); only Shobdon's own Vantage Pro2
  // station reports it today (worker/src/index.ts's forwardToIngest()).
  // Same "supplementary, not required" posture as dewpointC below.
  qfeHpa?: unknown;
  tempC?: unknown;
  dewpointC?: unknown;
  visibilityM?: unknown;
  rawSnapshotId?: unknown;
  // Optional - a source with no NOTAMs concept at all (most third-party
  // vendor APIs) simply omits this, stored as '[]'. See migration 0045's
  // own comment for why this was missing entirely until now.
  notams?: unknown;
  // Optional - runway in use + circuit hand, forwarded from
  // shobdon-central-capture's own parsed station page (parsed.runway/
  // parsed.hand). weather_observations.runway/runway_hand columns
  // already exist (added directly, no migration).
  runway?: unknown;
  runwayHand?: unknown;
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
  if (!isPlausibleReading(windSpeedKt, windDirDeg, qnhHpa, tempC)) {
    console.error("Rejecting implausible weather observation", {
      tenantId: keyLookup.tenantId,
      sourceType,
      windSpeedKt,
      windDirDeg,
      qnhHpa,
      tempC,
    });
    return jsonResponse({ error: "One or more fields are outside physically plausible bounds" }, 400);
  }
  const windGustKt = numberOrNull(body.windGustKt);
  const qfeHpa = numberOrNull(body.qfeHpa);
  const dewpointC = numberOrNull(body.dewpointC);
  const visibilityM = numberOrNull(body.visibilityM);
  const rawSnapshotId = typeof body.rawSnapshotId === "string" ? body.rawSnapshotId : null;
  const notams = stringArrayOrEmpty(body.notams);
  const runway = typeof body.runway === "string" ? body.runway : null;
  const runwayHand = typeof body.runwayHand === "string" ? body.runwayHand : null;

  const { tenantId } = keyLookup;

  const insertResult = await env.DB
    .prepare(
      `INSERT INTO weather_observations
         (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, raw_snapshot_id, source_type, notams_json, runway, runway_hand)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(tenantId, observedAt, windSpeedKt, windDirDeg, windGustKt, qnhHpa, qfeHpa, tempC, dewpointC, visibilityM, rawSnapshotId, sourceType, JSON.stringify(notams), runway, runwayHand)
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

  // SADDS automation round: mirrors this observation's runway/hand into
  // ops_panel_state.activeRunwayEnd/circuitDirection - the fields that
  // actually drive the ATC Control page's manual buttons, the TV
  // dashboard carousel, and RunwayWindWidget (via publicConfig.ts).
  // Without this, automated SADDS data and the "official" runway state
  // shown on the dashboard were two disconnected values - a visiting
  // pilot could see one runway on /pilot (fed straight from this same
  // weather_observations row via weather-latest.ts) and a different,
  // stale one on the clubhouse TV.
  //
  // ops_panel_state is keyed by organizationId (string), not this
  // table's own numeric tenant_id - resolved via tenants here rather
  // than threading organizationId through resolveApiKey/ApiKeyLookup,
  // which every other caller of that helper doesn't need.
  //
  // Only ever writes when this specific observation actually carried
  // runway data - a source/observation with no runway concept at all
  // (runway === null) leaves ops_panel_state completely untouched, same
  // "don't overwrite with nothing" posture as every other optional
  // field on this endpoint.
  if (runway !== null) {
    const orgRow = await env.DB
      .prepare("SELECT organization_id AS organizationId FROM tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ organizationId: string | null }>();

    if (orgRow?.organizationId) {
      const opsPanelRow = await env.DB
        .prepare("SELECT circuitDirection, runwayAutomationEnabled FROM ops_panel_state WHERE organizationId = ?")
        .bind(orgRow.organizationId)
        .first<{ circuitDirection: string; runwayAutomationEnabled: number }>();

      // No row yet -> automation is ON (migration 0076's own DEFAULT 1,
      // same "never a broken/blank read" posture the rest of this
      // table's callers already use) - a tenant that's never opened ATC
      // Control still gets auto-linked runway data from its very first
      // SADDS-carrying observation, not silently ignored until someone
      // visits that page once.
      const automationEnabled = opsPanelRow ? !!opsPanelRow.runwayAutomationEnabled : true;

      if (automationEnabled) {
        // "LH"/"RH" per the capture Worker's own parseRunway() output
        // (confirmed against real production data) - trimmed/upper-
        // cased defensively rather than assuming that exact casing
        // forever. An unrecognized/missing hand leaves circuitDirection
        // exactly as it already was (existing row) or defaults to
        // 'left' (brand-new row, matching ops-panel/index.ts's own
        // "no row yet" default) - runway alone is still worth recording
        // even when hand can't be determined, rather than discarding
        // the whole update.
        const normalizedHand = typeof runwayHand === "string" ? runwayHand.trim().toUpperCase() : null;
        const mappedCircuitDirection = normalizedHand === "LH" ? "left" : normalizedHand === "RH" ? "right" : null;
        const nextCircuitDirection = mappedCircuitDirection ?? opsPanelRow?.circuitDirection ?? "left";

        await env.DB
          .prepare(
            `INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, showAutoNotams, notamsCarouselIntervalSeconds, updatedAt)
             VALUES (?, ?, ?, '', '[]', 1, 5, ?)
             ON CONFLICT(organizationId) DO UPDATE SET
               activeRunwayEnd = excluded.activeRunwayEnd,
               circuitDirection = excluded.circuitDirection,
               updatedAt = excluded.updatedAt`
          )
          .bind(orgRow.organizationId, runway, nextCircuitDirection, now)
          .run();
      }
    }
  }

  return jsonResponse({ ok: true, sourceType, observedAt });
};
