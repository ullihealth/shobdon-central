// Platform-admin only: GET /api/platform/capture-history/chart -
// weather capture retention round, Charts view. Returns PRE-AGGREGATED
// bucket data (one row per time bucket: has-a-capture boolean, temp
// min/max, wind min/max, gust max) so the client never has to pull
// thousands of raw rows and bucket them in JS - the aggregation is a
// GROUP BY done here, in SQL, against whichever table is appropriate
// for the requested range (see chooseSource below).
//
// Query params:
//   tenantId - defaults to 1 (Shobdon), same convention as the sibling
//     raw-tables endpoint (./index.ts) - see that file's own comment
//     for why a tenant-picker isn't needed yet.
//   range - "day" | "week" | "month" | "year" | "custom"
//   start, end - ISO 8601 timestamps, REQUIRED when range="custom",
//     ignored otherwise (non-custom ranges are always computed relative
//     to "now" at request time, not persisted/cacheable).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

type Range = "day" | "week" | "month" | "year" | "custom";
type BucketUnit = "15min" | "hour" | "day" | "week";

interface BucketAggregateRow {
  bucket: string;
  captureCount: number;
  tempMin: number | null;
  tempMax: number | null;
  windMin: number | null;
  windMax: number | null;
  gustMax: number | null;
}

// Fixed, internal-only SQL snippets - never built from request input, so
// there's no injection surface despite being string-concatenated into
// the query below (the only thing request input selects is WHICH of
// these four fixed strings gets used, via the switch in bucketExprFor).
// Same 15-min truncation formula as migrations/0096 and 0097 and the
// capture worker's own CURRENT_BUCKET_SQL (worker/src/index.ts) - kept
// in agreement deliberately, so a 15-min-bucketed chart bucket and an
// actual weather_snapshots_15min row's own observed_at always line up
// exactly instead of drifting by used-a-slightly-different-formula.
function bucketExprFor(unit: BucketUnit): string {
  switch (unit) {
    case "15min":
      return "strftime('%Y-%m-%dT%H:', observed_at) || printf('%02d', (CAST(strftime('%M', observed_at) AS INTEGER) / 15) * 15) || ':00.000Z'";
    case "hour":
      return "strftime('%Y-%m-%dT%H:00:00.000Z', observed_at)";
    case "day":
      return "strftime('%Y-%m-%dT00:00:00.000Z', observed_at)";
    case "week":
      // Empirically verified against real dates before trusting this
      // (see this round's own verification pass) - the more commonly
      // quoted recipe, `date(x, 'weekday 1', '-7 days')`, is WRONG when
      // x itself already falls on a Monday: 'weekday 1' is a no-op in
      // that case (already the target weekday), so the trailing -7
      // days then rolls back a full extra week instead of staying put.
      // Stepping back 6 days FIRST avoids that: from any day of a given
      // week, -6 days always lands within the PRIOR week, so the
      // following 'weekday 1' advance always lands on the current
      // week's own Monday, including when the input was already Monday.
      return "date(observed_at, '-6 days', 'weekday 1') || 'T00:00:00.000Z'";
  }
}

const BUCKET_MS: Record<BucketUnit, number> = {
  "15min": 15 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
};

// Hard ceiling on generated buckets, independent of the range-based
// choices below - those choices already keep real counts well under
// this (year → ~52 weekly buckets, month → ~30 daily, week → 168
// hourly, day → 96 15-min), but a pathological Custom range (e.g. a
// multi-decade span forced through a small bucket unit) shouldn't be
// able to make this endpoint generate an unbounded array.
const MAX_BUCKETS = 2000;

// Same span-based escalation for BOTH the Year range and any Custom
// range - "the same logic as above" per this round's own spec, so a
// Custom range that happens to span ~1 year behaves identically to
// picking "Year". Year itself is pinned to weekly rather than daily:
// 365 daily bars over this page's ~1400px content width is under 4px
// per bar, unreadable as either a hover target or a visible range
// shape - 52 weekly bars (~27px each) is the readable tradeoff. Noted
// per the round's own explicit "use your judgement, note which you
// chose" instruction.
function bucketUnitForSpan(spanMs: number): BucketUnit {
  const DAY_MS = 24 * 60 * 60_000;
  if (spanMs <= DAY_MS) return "15min";
  if (spanMs <= 7 * DAY_MS) return "hour";
  if (spanMs <= 31 * DAY_MS) return "day";
  return "week";
}

interface RangeSpec {
  start: Date;
  end: Date;
  bucketUnit: BucketUnit;
  // "day" is the ONLY range that reads weather_observations (the raw,
  // rolling-24h table) - everything else, including Custom ranges that
  // happen to fall entirely within the last 24h, reads
  // weather_snapshots_15min instead. This is a deliberate simplification
  // (see this file's own header comment / the round's own spec): the
  // snapshot table already has 15-min resolution covering the full
  // 12-month history INCLUDING the last 24h (the capture worker's cron
  // writes into it continuously, not just historically), so there's no
  // real accuracy loss - only one fewer special case to keep correct.
  table: "weather_observations" | "weather_snapshots_15min";
}

function resolveRange(range: Range, url: URL): { spec: RangeSpec } | { error: string } {
  const now = new Date();
  const DAY_MS = 24 * 60 * 60_000;

  if (range === "day") {
    return { spec: { start: new Date(now.getTime() - DAY_MS), end: now, bucketUnit: "15min", table: "weather_observations" } };
  }
  if (range === "week") {
    return { spec: { start: new Date(now.getTime() - 7 * DAY_MS), end: now, bucketUnit: "hour", table: "weather_snapshots_15min" } };
  }
  if (range === "month") {
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return { spec: { start, end: now, bucketUnit: "day", table: "weather_snapshots_15min" } };
  }
  if (range === "year") {
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return { spec: { start, end: now, bucketUnit: "week", table: "weather_snapshots_15min" } };
  }

  // range === "custom"
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  if (!startParam || !endParam) return { error: "start and end are required for range=custom" };

  const start = new Date(startParam);
  const end = new Date(endParam);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: "start and end must be valid ISO 8601 timestamps" };
  if (start.getTime() >= end.getTime()) return { error: "start must be before end" };

  const bucketUnit = bucketUnitForSpan(end.getTime() - start.getTime());
  return { spec: { start, end, bucketUnit, table: "weather_snapshots_15min" } };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const tenantId = tenantIdParam ? Number(tenantIdParam) : 1;
  if (!Number.isFinite(tenantId)) return jsonResponse({ error: "tenantId must be a number" }, 400);

  const rangeParam = url.searchParams.get("range") ?? "day";
  if (!["day", "week", "month", "year", "custom"].includes(rangeParam)) {
    return jsonResponse({ error: "range must be one of: day, week, month, year, custom" }, 400);
  }
  const range = rangeParam as Range;

  const resolved = resolveRange(range, url);
  if ("error" in resolved) return jsonResponse({ error: resolved.error }, 400);
  const { start, end, bucketUnit, table } = resolved.spec;

  const expectedBucketCount = Math.ceil((end.getTime() - start.getTime()) / BUCKET_MS[bucketUnit]) + 1;
  if (expectedBucketCount > MAX_BUCKETS) {
    return jsonResponse({ error: `Requested range would produce ${expectedBucketCount} buckets (max ${MAX_BUCKETS}) - narrow the range` }, 400);
  }

  const tenantRow = await env.DB.prepare("SELECT name, slug FROM tenants WHERE id = ?").bind(tenantId).first<{ name: string; slug: string }>();
  if (!tenantRow) return jsonResponse({ error: "Unknown tenantId" }, 404);

  const bucketExpr = bucketExprFor(bucketUnit);
  const { results } = await env.DB
    .prepare(
      `SELECT
         ${bucketExpr} AS bucket,
         COUNT(*) AS captureCount,
         MIN(temp_c) AS tempMin,
         MAX(temp_c) AS tempMax,
         MIN(wind_speed_kt) AS windMin,
         MAX(wind_speed_kt) AS windMax,
         MAX(wind_gust_kt) AS gustMax
       FROM ${table}
       WHERE tenant_id = ? AND observed_at >= ? AND observed_at <= ?
       GROUP BY bucket`
    )
    .bind(tenantId, start.toISOString(), end.toISOString())
    .all<BucketAggregateRow>();

  // GROUP BY only returns buckets that have at least one row - a bucket
  // with zero captures (the whole point of the uptime strip) simply
  // never appears. Walking the full expected bucket sequence here and
  // looking up each one in a Map is what turns "absent from the SQL
  // result" into an explicit hasCapture: false entry, rather than a
  // silently shorter/misaligned array the client would have to detect
  // gaps in itself.
  const byBucket = new Map(results.map((row) => [row.bucket, row]));
  const buckets: Array<{
    bucket: string;
    hasCapture: boolean;
    captureCount: number;
    tempMin: number | null;
    tempMax: number | null;
    windMin: number | null;
    windMax: number | null;
    gustMax: number | null;
  }> = [];

  const stepMs = BUCKET_MS[bucketUnit];
  // Align the walk to the same bucket boundary the SQL expression
  // itself produces (e.g. for "day" buckets, walk local calendar days
  // via setUTCDate/setUTCHours rather than raw start.getTime() + n*stepMs,
  // since calendar days/weeks aren't a fixed number of milliseconds
  // apart when... they actually are in UTC with no DST, so a fixed-step
  // walk is safe here - D1/SQLite's strftime output above is always UTC).
  let cursor = alignToBucketStart(start, bucketUnit);
  const endTime = end.getTime();
  while (cursor.getTime() <= endTime) {
    const key = cursor.toISOString();
    const row = byBucket.get(key);
    buckets.push({
      bucket: key,
      hasCapture: (row?.captureCount ?? 0) > 0,
      captureCount: row?.captureCount ?? 0,
      tempMin: row?.tempMin ?? null,
      tempMax: row?.tempMax ?? null,
      windMin: row?.windMin ?? null,
      windMax: row?.windMax ?? null,
      gustMax: row?.gustMax ?? null,
    });
    cursor = new Date(cursor.getTime() + stepMs);
  }

  return jsonResponse({
    tenantId,
    tenantName: tenantRow.name,
    tenantSlug: tenantRow.slug,
    range,
    bucketUnit,
    source: table,
    start: start.toISOString(),
    end: end.toISOString(),
    buckets,
  });
};

// Mirrors the SQL bucket expressions in bucketExprFor - given an
// arbitrary start timestamp, returns the bucket boundary it falls in,
// so the JS-side "walk every expected bucket" loop below produces the
// exact same boundary strings the SQL GROUP BY does (required for the
// Map lookup by string key to ever hit).
function alignToBucketStart(date: Date, unit: BucketUnit): Date {
  const aligned = new Date(date);
  aligned.setUTCMilliseconds(0);
  aligned.setUTCSeconds(0);
  if (unit === "15min") {
    aligned.setUTCMinutes(Math.floor(aligned.getUTCMinutes() / 15) * 15);
    return aligned;
  }
  aligned.setUTCMinutes(0);
  if (unit === "hour") return aligned;
  aligned.setUTCHours(0);
  if (unit === "day") return aligned;
  // week: roll back to Monday (UTC day-of-week 1; getUTCDay() is 0=Sun..6=Sat)
  const dayOfWeek = aligned.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  aligned.setUTCDate(aligned.getUTCDate() - daysSinceMonday);
  return aligned;
}
