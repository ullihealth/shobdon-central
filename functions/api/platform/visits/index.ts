// Platform-admin only: GET /api/platform/visits[?tenantId=&slug=] - backs
// the /platform/visits page (src/pages/PlatformVisitsPage.tsx), a
// reverse-chronological, filterable view over display_visits (migration
// 0041) - the per-visit log written by functions/api/public/heartbeat.ts.
//
// requirePlatformAdmin, NOT requireDeveloper, same reasoning as
// tenants/index.ts's own comment: this must work independent of any
// org-membership resolution.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface VisitRow {
  id: number;
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  displaySlug: string;
  visitedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  // Migration 0055 - NULL on every row written before that migration
  // (see its own comment: no backfill, going-forward only). The
  // frontend shows an explicit "not available" message rather than
  // treating NULL as "known to be unavailable".
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  geoLatitude: string | null;
  geoLongitude: string | null;
}

// Caps a single response - this is a live ops log, not an export; the
// filters (tenant/display/date-range) are the intended way to narrow
// further, not pagination. Confirmed against production (2026-07): total
// display_visits is 5,021 rows (Shobdon alone: 4,993) - well beyond this
// cap, so an unfiltered request only ever sees a thin recent slice.
// tenantId/from/to exist specifically so a filtered query can reach rows
// this cap would otherwise hide, not just re-sort what's already in view.
const MAX_ROWS = 500;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const slugParam = url.searchParams.get("slug");
  // Plain "YYYY-MM-DD" from a native <input type="date"> - from is
  // widened to that day's start, to to that day's end, so the range is
  // inclusive of both endpoint dates in local-to-the-string terms
  // (visited_at is stored as an ISO UTC string, same comparison basis).
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
      `SELECT v.id AS id, v.tenant_id AS tenantId, t.name AS tenantName, t.slug AS tenantSlug,
              v.display_slug AS displaySlug, v.visited_at AS visitedAt,
              v.ip_address AS ipAddress, v.user_agent AS userAgent,
              v.geo_country AS geoCountry, v.geo_region AS geoRegion, v.geo_city AS geoCity,
              v.geo_latitude AS geoLatitude, v.geo_longitude AS geoLongitude
       FROM display_visits v
       JOIN tenants t ON t.id = v.tenant_id
       ${whereClause}
       ORDER BY v.visited_at DESC
       LIMIT ${MAX_ROWS}`
    )
    .bind(...bindings)
    .all<VisitRow>();

  return jsonResponse({ visits: results });
};
