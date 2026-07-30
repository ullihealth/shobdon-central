// Platform-admin only: GET /api/platform/known-devices/suggestions[?tenantId=] -
// candidate (tenant, display, IP) combos from display_visits that haven't
// already been confirmed or dismissed, ranked by how strong a signal they
// are that this IP is the tenant's real device: frequency first (a device
// that's pinged 200 times is far more likely to be the real screen than
// one seen twice), recency second as a tiebreaker.
//
// Deliberately NOT scoped to a single "the" IP per tenant+display - see
// migration 0056's own comment on why (dynamic IPs, multiple candidates
// can legitimately be active at once as an ISP rotates). This just
// surfaces every candidate that hasn't been decided on yet; a human
// (Jeff) picks which ones are real.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface SuggestionRow {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  displaySlug: string;
  displayName: string | null;
  ipAddress: string;
  visitCount: number;
  firstSeen: string;
  lastSeen: string;
  // Migration 0057 (global IP directory) cross-check - a real gap this
  // catches: 185.69.144.84 was confirmed as Shobdon's known device
  // despite also appearing under GyroPlane Train's log with heavily
  // overlapping timestamps, strong evidence it's a shared dev/test
  // source rather than either tenant's real display. Surfaced here so
  // that mistake is visible BEFORE confirming, not discovered after.
  labelGroup: string | null;
}

// A candidate list, not a live feed - caps at a generous number so a
// tenant with genuinely dozens of rotating IPs (see this table's own
// history: Shobdon's 'main' display alone had 57 distinct IPs at last
// count) doesn't produce an unbounded response, without meaningfully
// limiting the realistic case.
const SUGGESTIONS_MAX_ROWS = 300;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const url = new URL(request.url);
  const tenantIdParam = url.searchParams.get("tenantId");

  const conditions: string[] = ["v.ip_address IS NOT NULL"];
  const bindings: (string | number)[] = [];
  if (tenantIdParam) {
    const tenantId = Number(tenantIdParam);
    if (Number.isFinite(tenantId)) {
      conditions.push("v.tenant_id = ?");
      bindings.push(tenantId);
    }
  }
  const whereClause = conditions.join(" AND ");

  const { results } = await env.DB
    .prepare(
      `SELECT v.tenant_id AS tenantId, t.name AS tenantName, t.slug AS tenantSlug,
              v.display_slug AS displaySlug, td.name AS displayName, v.ip_address AS ipAddress,
              COUNT(*) AS visitCount, MIN(v.visited_at) AS firstSeen, MAX(v.visited_at) AS lastSeen,
              l.group_name AS labelGroup
       FROM display_visits v
       JOIN tenants t ON t.id = v.tenant_id
       LEFT JOIN tenant_displays td ON td.tenant_id = v.tenant_id AND td.slug = v.display_slug
       LEFT JOIN ip_labels l ON l.ip_address = v.ip_address
       WHERE ${whereClause}
         AND NOT EXISTS (
           SELECT 1 FROM tenant_known_devices k
           WHERE k.tenant_id = v.tenant_id AND k.display_slug = v.display_slug
             AND k.ip_address = v.ip_address AND k.active = 1
         )
       GROUP BY v.tenant_id, v.display_slug, v.ip_address
       ORDER BY visitCount DESC, lastSeen DESC
       LIMIT ${SUGGESTIONS_MAX_ROWS}`
    )
    .bind(...bindings)
    .all<SuggestionRow>();

  return jsonResponse({ suggestions: results });
};
