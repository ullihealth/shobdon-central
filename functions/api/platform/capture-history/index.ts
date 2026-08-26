// Platform-admin only: GET /api/platform/capture-history?tenantId=&limit= -
// weather capture retention round. Simple raw read of both retention
// tables side by side: weather_observations (rolling 24h full-resolution
// capture, trimmed by the capture worker's own cron - see worker/src/
// index.ts's runSnapshotAndTrimJob) and weather_snapshots_15min (rolling
// 12-month downsampled history, one row per 15-minute bucket) - a
// diagnostic list view to confirm the retention pipeline is actually
// behaving. Pre-aggregated chart data lives in the sibling ./chart.ts
// endpoint, not here - this one stays a raw, uncapped-columns dump.
//
// tenantId defaults to 1 (Shobdon) rather than requiring the caller to
// know/pass it - only 'atc'-provider tenants generate real capture rows
// at all today (99.97% of them Shobdon's, per this round's own Step 0
// investigation), so a tenant-picker UI would be speculative complexity
// for a page whose entire real audience is one tenant right now. Still
// accepts an explicit ?tenantId= override rather than hardcoding it, so
// this doesn't need touching again the day a second station-owning
// tenant exists.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface ObservationRow {
  observedAt: string;
  windSpeedKt: number | null;
  windDirDeg: number | null;
  windGustKt: number | null;
  qnhHpa: number | null;
  qfeHpa: number | null;
  tempC: number | null;
  dewpointC: number | null;
  visibilityM: number | null;
  runway: string | null;
  runwayHand: string | null;
  sourceType: string;
}

interface SnapshotRow extends ObservationRow {}

// Default cap on rows returned per table - both tables can genuinely
// hold thousands of rows (24h at a 15s capture interval is ~5,760 raw
// rows; 12 months of 15-min snapshots is up to ~35,040) and this is a
// raw list view, not a paginated grid - most-recent-first with a
// generous-but-bounded default keeps the page responsive while still
// showing enough to spot-check the retention pipeline is working.
// Overridable via ?limit= for anyone who wants more.
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 5000;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const tenantId = tenantIdParam ? Number(tenantIdParam) : 1;
  if (!Number.isFinite(tenantId)) return jsonResponse({ error: "tenantId must be a number" }, 400);

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || DEFAULT_LIMIT)) : DEFAULT_LIMIT;

  const tenantRow = await env.DB.prepare("SELECT name, slug FROM tenants WHERE id = ?").bind(tenantId).first<{ name: string; slug: string }>();
  if (!tenantRow) return jsonResponse({ error: "Unknown tenantId" }, 404);

  const columns = `observed_at AS observedAt, wind_speed_kt AS windSpeedKt, wind_dir_deg AS windDirDeg, wind_gust_kt AS windGustKt,
     qnh_hpa AS qnhHpa, qfe_hpa AS qfeHpa, temp_c AS tempC, dewpoint_c AS dewpointC, visibility_m AS visibilityM,
     runway, runway_hand AS runwayHand, source_type AS sourceType`;

  const [observationsResult, observationsCountRow, snapshotsResult, snapshotsCountRow] = await Promise.all([
    env.DB
      .prepare(`SELECT ${columns} FROM weather_observations WHERE tenant_id = ? ORDER BY observed_at DESC LIMIT ?`)
      .bind(tenantId, limit)
      .all<ObservationRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM weather_observations WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
    env.DB
      .prepare(`SELECT ${columns} FROM weather_snapshots_15min WHERE tenant_id = ? ORDER BY observed_at DESC LIMIT ?`)
      .bind(tenantId, limit)
      .all<SnapshotRow>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM weather_snapshots_15min WHERE tenant_id = ?").bind(tenantId).first<{ count: number }>(),
  ]);

  return jsonResponse({
    tenantId,
    tenantName: tenantRow.name,
    tenantSlug: tenantRow.slug,
    limit,
    observations: observationsResult.results,
    observationsTotalCount: observationsCountRow?.count ?? 0,
    snapshots: snapshotsResult.results,
    snapshotsTotalCount: snapshotsCountRow?.count ?? 0,
  });
};
