// Platform-admin only: GET /api/platform/uptime-report?tenantId=&displaySlug=&from=&to= -
// Phase C of the visit-log uptime work. Computes expected vs. actual
// heartbeats and a gap list for a tenant+display over a date range, using
// ONLY visits from that tenant+display's confirmed known devices (Phase B,
// migration 0056) - this is the whole point of Phase B existing first: an
// uptime number built from EVERY IP that ever hit the URL would count
// unrelated traffic (a passerby, a dev testing something) as "the display
// was on", which defeats the purpose of an audit artifact meant to
// verify/dispute advertiser billing.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface VisitTimeRow {
  visitedAt: string;
}

interface Gap {
  start: string;
  end: string;
  durationMinutes: number;
}

// Matches DEDUP_WINDOW_MS in functions/api/public/heartbeat.ts - that's
// the interval this whole report's math is built on (confirmed via
// that file directly, not assumed): the browser pings every 3 minutes,
// but the server only WRITES a new row every ~20 minutes in steady
// state (or immediately on IP/user-agent change), so 20 minutes - not
// the 3-minute ping rate - is the real expected spacing between logged
// rows for a continuously-running display.
const EXPECTED_INTERVAL_MINUTES = 20;

// "Missed by more than one interval" (the report's own spec) - a gap
// is flagged only once two consecutive expected pings have been
// missed, not one, since a single row landing 21-25 minutes after the
// last one is well within normal jitter (server load, a slightly late
// client timer) and would otherwise flag constantly on a display that
// was never actually down.
const GAP_THRESHOLD_MINUTES = EXPECTED_INTERVAL_MINUTES * 2;

function minutesBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 60_000;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const displaySlug = url.searchParams.get("displaySlug");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const tenantId = Number(tenantIdParam);
  if (!Number.isFinite(tenantId)) return jsonResponse({ error: "tenantId is required" }, 400);
  if (!displaySlug) return jsonResponse({ error: "displaySlug is required" }, 400);
  if (!fromParam || !/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) return jsonResponse({ error: "from (YYYY-MM-DD) is required" }, 400);
  if (!toParam || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) return jsonResponse({ error: "to (YYYY-MM-DD) is required" }, 400);

  const fromIso = `${fromParam}T00:00:00.000Z`;
  const toIso = `${toParam}T23:59:59.999Z`;

  const tenantRow = await env.DB.prepare("SELECT name, slug FROM tenants WHERE id = ?").bind(tenantId).first<{ name: string; slug: string }>();
  if (!tenantRow) return jsonResponse({ error: "Unknown tenantId" }, 404);

  const { results: knownIpRows } = await env.DB
    .prepare("SELECT ip_address AS ipAddress FROM tenant_known_devices WHERE tenant_id = ? AND display_slug = ? AND status = 'confirmed' AND active = 1")
    .bind(tenantId, displaySlug)
    .all<{ ipAddress: string }>();
  const knownIps = knownIpRows.map((r) => r.ipAddress);

  if (knownIps.length === 0) {
    // Not a 0%-uptime report - there's no basis to compute one at all
    // without at least one confirmed device. Distinct from "computed,
    // and it happens to be 0%" (a real gap the whole range), which
    // DOES return a normal report below.
    return jsonResponse({
      tenantId,
      tenantName: tenantRow.name,
      tenantSlug: tenantRow.slug,
      displaySlug,
      from: fromParam,
      to: toParam,
      error: "No confirmed known devices for this tenant/display - confirm at least one IP on /platform/known-devices first",
    });
  }

  const placeholders = knownIps.map(() => "?").join(",");
  const { results: visitRows } = await env.DB
    .prepare(
      `SELECT visited_at AS visitedAt FROM display_visits
       WHERE tenant_id = ? AND display_slug = ? AND ip_address IN (${placeholders})
         AND visited_at >= ? AND visited_at <= ?
       ORDER BY visited_at ASC`
    )
    .bind(tenantId, displaySlug, ...knownIps, fromIso, toIso)
    .all<VisitTimeRow>();

  const visitedAtTimes = visitRows.map((r) => r.visitedAt);
  const rangeMinutes = minutesBetween(fromIso, toIso);
  const expectedHeartbeats = Math.max(1, Math.round(rangeMinutes / EXPECTED_INTERVAL_MINUTES));
  const actualHeartbeats = visitedAtTimes.length;
  // Capped at 100 - dedup means rows are normally AT LEAST ~20 minutes
  // apart, so actual should never meaningfully exceed expected, but a
  // display with a very chatty IP/user-agent change pattern could push
  // it slightly over, and >100% uptime isn't a meaningful thing to show.
  const uptimePercent = Math.min(100, Math.round((actualHeartbeats / expectedHeartbeats) * 1000) / 10);

  const gaps: Gap[] = [];
  if (visitedAtTimes.length === 0) {
    gaps.push({ start: fromIso, end: toIso, durationMinutes: Math.round(rangeMinutes) });
  } else {
    const leadingGap = minutesBetween(fromIso, visitedAtTimes[0]);
    if (leadingGap > GAP_THRESHOLD_MINUTES) {
      gaps.push({ start: fromIso, end: visitedAtTimes[0], durationMinutes: Math.round(leadingGap) });
    }
    for (let i = 0; i < visitedAtTimes.length - 1; i++) {
      const delta = minutesBetween(visitedAtTimes[i], visitedAtTimes[i + 1]);
      if (delta > GAP_THRESHOLD_MINUTES) {
        gaps.push({ start: visitedAtTimes[i], end: visitedAtTimes[i + 1], durationMinutes: Math.round(delta) });
      }
    }
    const trailingGap = minutesBetween(visitedAtTimes[visitedAtTimes.length - 1], toIso);
    if (trailingGap > GAP_THRESHOLD_MINUTES) {
      gaps.push({ start: visitedAtTimes[visitedAtTimes.length - 1], end: toIso, durationMinutes: Math.round(trailingGap) });
    }
  }

  const report = {
    tenantId,
    tenantName: tenantRow.name,
    tenantSlug: tenantRow.slug,
    displaySlug,
    from: fromParam,
    to: toParam,
    knownIpsUsed: knownIps,
    expectedIntervalMinutes: EXPECTED_INTERVAL_MINUTES,
    expectedHeartbeats,
    actualHeartbeats,
    uptimePercent,
    gaps,
  };

  // Second export type alongside Phase A's raw Visit Log CSV (functions/
  // api/platform/visits/export.ts) - same underlying computation, just
  // rendered as a document rather than JSON for the UI. This is the
  // artifact meant to be dropped into an email/doc or handed to a
  // tenant as billing evidence, so it leads with the summary numbers
  // before the gap detail, not the other way around.
  if (url.searchParams.get("format") === "csv") {
    const summaryLines = [
      "Uptime Report",
      `Tenant,${csvField(report.tenantName)} (${report.tenantSlug})`,
      `Display,${csvField(report.displaySlug)}`,
      `Date range,${report.from} to ${report.to}`,
      `Known IP(s) used,${csvField(report.knownIpsUsed.join("; "))}`,
      `Expected interval,${report.expectedIntervalMinutes} minutes`,
      `Expected heartbeats,${report.expectedHeartbeats}`,
      `Actual heartbeats,${report.actualHeartbeats}`,
      `Uptime %,${report.uptimePercent}`,
      "",
      "Gap Start,Gap End,Duration (minutes)",
      ...report.gaps.map((g) => `${g.start},${g.end},${g.durationMinutes}`),
    ];
    const csv = summaryLines.join("\r\n") + "\r\n";
    const filename = `uptime-report-${report.tenantSlug}-${report.displaySlug}-${report.from}_to_${report.to}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return jsonResponse(report);
};

// Same RFC 4180 quoting rule as visits/export.ts's own csvField - kept
// as a local duplicate rather than a shared import, matching this
// codebase's established "small, self-contained Pages Functions"
// convention (see e.g. tenantAuth.ts being the one deliberate shared
// exception, not the norm).
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
