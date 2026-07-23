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
}

// Caps a single response - this is a live ops log, not an export; the
// filters (tenant/display) are the intended way to narrow further, not
// pagination.
const MAX_ROWS = 500;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");
  const slugParam = url.searchParams.get("slug");

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
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await env.DB
    .prepare(
      `SELECT v.id AS id, v.tenant_id AS tenantId, t.name AS tenantName, t.slug AS tenantSlug,
              v.display_slug AS displaySlug, v.visited_at AS visitedAt,
              v.ip_address AS ipAddress, v.user_agent AS userAgent
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
