// Platform-wide feature request board: GET /api/tenant/feature-requests
// lists EVERY entry across every tenant (not scoped to the caller's own
// organizationId - see migration 0066's own comment on why this table has
// no per-row tenant scoping at all), POST submits a new one under the
// caller's own tenant. Both owner/admin-gated (requireOwner) - any tenant
// admin can see the shared board and add to it. Status changes are a
// separate, developer-only route (../[id].ts) - not reachable here.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface FeatureRequestRow {
  id: string;
  title: string;
  description: string;
  status: string;
  submittedByOrgId: string;
  createdAt: string;
  submittedByTenantName: string | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;

  // LEFT JOIN, not INNER - same defensive posture as resolveParentTenant.ts's
  // own comment on organization rows with no matching tenants row; an
  // orphaned submitted_by_org_id should still show the entry (tenant name
  // just comes back null) rather than silently vanish from the shared list.
  const { results } = await env.DB
    .prepare(
      `SELECT fr.id AS id, fr.title AS title, fr.description AS description, fr.status AS status,
              fr.submitted_by_org_id AS submittedByOrgId, fr.created_at AS createdAt,
              t.name AS submittedByTenantName
       FROM feature_requests fr
       LEFT JOIN tenants t ON t.organization_id = fr.submitted_by_org_id
       ORDER BY fr.created_at DESC`
    )
    .all<FeatureRequestRow>();

  return jsonResponse({ requests: results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireOwner(request, env);
  if ("error" in result) return result.error;
  const { organizationId } = result.membership;

  const body = (await request.json().catch(() => null)) as { title?: unknown; description?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";

  if (!title) return jsonResponse({ error: "title is required" }, 400);
  if (!description) return jsonResponse({ error: "description is required" }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO feature_requests (id, title, description, status, submitted_by_org_id, submitted_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'idea', ?, ?, ?, ?)`
    )
    .bind(id, title, description, organizationId, result.userId, now, now)
    .run();

  return jsonResponse({ id, title, description, status: "idea", submittedByOrgId: organizationId, createdAt: now });
};
