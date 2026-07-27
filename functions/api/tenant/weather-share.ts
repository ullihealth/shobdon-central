// Tenant-facing, read-only GET /api/tenant/weather-share - lets a
// tenant's own owner/admin see whether their weather is currently being
// sourced from another tenant via tenant_weather_shares (migration
// 0029), a fact that was previously only visible to a platform admin at
// /platform/tenants (functions/api/platform/tenants/[id]/weather-share.ts,
// which owns the PUT side - this file is deliberately GET-only, no
// write path, per the standing decision that weather-sharing stays
// platform-admin-configured, not tenant-editable). Same currentShare()
// query as that file, just resolved from the CALLER's own membership
// (requireTenant) instead of a platform-admin-supplied :id param.
import { requireTenant, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;

  const share = await env.DB
    .prepare(
      `SELECT t.slug AS slug, t.name AS name
       FROM tenant_weather_shares s
       JOIN tenants target ON target.organization_id = ? AND target.id = s.target_tenant_id
       JOIN tenants t ON t.id = s.source_tenant_id`
    )
    .bind(result.membership.organizationId)
    .first<{ slug: string; name: string }>();

  return jsonResponse({ sourceTenantSlug: share?.slug ?? null, sourceTenantName: share?.name ?? null });
};
