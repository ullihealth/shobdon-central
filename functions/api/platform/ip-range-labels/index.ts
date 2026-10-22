// Platform-admin only: GET/POST /api/platform/ip-range-labels - range labels
// (migration 0119): label an IP prefix once and every matching address gets it.
// GET lists them with how many distinct IPs / tenants each covered in the last
// 30 days; POST creates (or re-points) one. Never called automatically - a
// range label only exists because Jeff saved one.
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

  const cutoff = coverageCutoff();
  const { results } = await env.DB
    .prepare(
      `SELECT r.id AS id, r.prefix AS prefix, r.group_name AS groupName, r.created_at AS createdAt,
              (SELECT COUNT(DISTINCT v.ip_address) FROM display_visits v
                WHERE v.ip_address LIKE r.prefix || '%' AND v.visited_at >= ?) AS ipsCovered,
              (SELECT COUNT(DISTINCT v.tenant_id) FROM display_visits v
                WHERE v.ip_address LIKE r.prefix || '%' AND v.visited_at >= ?) AS tenantsCovered
       FROM ip_range_labels r
       ORDER BY r.group_name, r.prefix`
    )
    .bind(cutoff, cutoff)
    .all<{ id: number; prefix: string; groupName: string; createdAt: string; ipsCovered: number; tenantsCovered: number }>();

  return jsonResponse({ rangeLabels: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const body = (await request.json().catch(() => null)) as { prefix?: unknown; groupName?: unknown } | null;
  if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

  const prefix = typeof body.prefix === "string" ? normaliseRangePrefix(body.prefix) : null;
  if (!prefix) {
    return jsonResponse({ error: "prefix must be IPv4 with 2 or 3 octets (e.g. 187.40.50) or IPv6 with 1 to 4 groups" }, 400);
  }
  const groupName = typeof body.groupName === "string" ? body.groupName.trim() : "";
  if (!groupName) return jsonResponse({ error: "groupName is required" }, 400);

  await env.DB
    .prepare(
      `INSERT INTO ip_range_labels (prefix, group_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(prefix) DO UPDATE SET group_name = excluded.group_name`
    )
    .bind(prefix, groupName, new Date().toISOString())
    .run();

  return jsonResponse({ ok: true, prefix });
};
