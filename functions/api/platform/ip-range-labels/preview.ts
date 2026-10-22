// Platform-admin only, READ-ONLY: GET /api/platform/ip-range-labels/preview
//   ?prefix=187.40.50&groupName=Jeff
// What a range label WOULD cover, shown in the label editor before saving:
// distinct IPs and tenants seen in the last 30 days, plus any addresses in the
// range that already carry a DIFFERENT exact label (informational - an exact
// label always beats the range, so those rows keep their own label).
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { normaliseRangePrefix, coverageCutoff } from "../../_utils/ipRange";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const prefix = normaliseRangePrefix(url.searchParams.get("prefix") ?? "");
  if (!prefix) return jsonResponse({ error: "Not a valid range prefix" }, 400);
  const groupName = (url.searchParams.get("groupName") ?? "").trim();

  const coverage = await env.DB
    .prepare(
      `SELECT COUNT(DISTINCT ip_address) AS ips, COUNT(DISTINCT tenant_id) AS tenants
       FROM display_visits WHERE ip_address LIKE ? AND visited_at >= ?`
    )
    .bind(`${prefix}%`, coverageCutoff())
    .first<{ ips: number; tenants: number }>();

  const { results: differentExact } = await env.DB
    .prepare(
      `SELECT ip_address AS ipAddress, group_name AS groupName FROM ip_labels
       WHERE ip_address LIKE ? AND group_name <> ? ORDER BY ip_address LIMIT 50`
    )
    .bind(`${prefix}%`, groupName)
    .all<{ ipAddress: string; groupName: string }>();

  return jsonResponse({
    prefix,
    ips: coverage?.ips ?? 0,
    tenants: coverage?.tenants ?? 0,
    differentExactLabels: differentExact,
  });
};
