// Platform-admin only: GET /api/platform/visits/export[?tenantId=&slug=&from=&to=] -
// CSV download of the SAME filtered result set index.ts's GET returns, but
// without that endpoint's MAX_ROWS=500 cap. That cap exists specifically to
// keep the live-viewing page from serving pathologically huge responses on
// every keystroke-triggered refetch, not because 500 is a meaningful ceiling
// on what an intentional, one-off export should return - an export is a
// single deliberate action, not a repeatedly-refetched live view, so a much
// higher safety ceiling (guarding against a genuinely unbounded query, not
// against "too much real data") is the right tradeoff here.
//
// Same requirePlatformAdmin gate as index.ts - an export is just a
// differently-formatted read of the exact same data that gate already
// protects, not a new access boundary.
import { requirePlatformAdmin, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface VisitExportRow {
  visitedAt: string;
  tenantName: string;
  tenantSlug: string;
  displaySlug: string;
  ipAddress: string | null;
  userAgent: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
}

// Safety ceiling, not a practical limit - see this file's own header
// comment. 100,000 rows is roughly 20x production's entire current
// display_visits table (confirmed 2026-07: ~5,000 rows total), so this
// exists purely to bound a pathological query, never to actually cap a
// real export.
const EXPORT_MAX_ROWS = 100_000;

// RFC 4180 - only fields containing a comma, double-quote, or newline
// need quoting/escaping; everything else is passed through untouched so
// a plain IP address or timestamp doesn't grow unnecessary quotes.
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: VisitExportRow[]): string {
  const header = ["Time", "Tenant", "Display", "IP Address", "User Agent", "Country", "Region", "City"]
    .map(csvField)
    .join(",");
  const lines = rows.map((r) =>
    [
      r.visitedAt,
      r.tenantName,
      r.displaySlug,
      r.ipAddress ?? "",
      r.userAgent ?? "",
      r.geoCountry ?? "",
      r.geoRegion ?? "",
      r.geoCity ?? "",
    ]
      .map((v) => csvField(v))
      .join(",")
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const slugParam = url.searchParams.get("slug");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (tenantIdParam) {
    const tenantId = Number(tenantIdParam);
    if (Number.isFinite(tenantId)) {
      conditions.push("v.tenant_id = ?");
      bindings.push(tenantId);
    }
  }
  if (slugParam) {
    conditions.push("v.display_slug = ?");
    bindings.push(slugParam);
  }
  if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
    conditions.push("v.visited_at >= ?");
    bindings.push(`${fromParam}T00:00:00.000Z`);
  }
  if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    conditions.push("v.visited_at <= ?");
    bindings.push(`${toParam}T23:59:59.999Z`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await env.DB
    .prepare(
      `SELECT v.visited_at AS visitedAt, t.name AS tenantName, t.slug AS tenantSlug,
              v.display_slug AS displaySlug, v.ip_address AS ipAddress, v.user_agent AS userAgent,
              v.geo_country AS geoCountry, v.geo_region AS geoRegion, v.geo_city AS geoCity
       FROM display_visits v
       JOIN tenants t ON t.id = v.tenant_id
       ${whereClause}
       ORDER BY v.visited_at DESC
       LIMIT ${EXPORT_MAX_ROWS}`
    )
    .bind(...bindings)
    .all<VisitExportRow>();

  const csv = toCsv(results);
  // Filename reflects the actual scope exported, not a generic name -
  // makes a downloaded file self-describing once it's out of the
  // browser's download list and sitting on disk or attached to an email.
  const scopeLabel = tenantIdParam ? (slugParam ? "tenant-display" : "tenant") : "all-tenants";
  const dateLabel = fromParam || toParam ? `_${fromParam || "start"}_to_${toParam || "now"}` : "";
  const filename = `visit-log-${scopeLabel}${dateLabel}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
