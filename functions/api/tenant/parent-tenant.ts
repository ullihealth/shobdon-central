// Tenant-facing, read-only GET /api/tenant/parent-tenant - lets a
// tenant's own owner/admin see whether they're currently linked to a
// parent airfield (tenants.parent_tenant_id, migration 0059), a fact
// that was previously only visible to a platform admin at
// /platform/tenants (functions/api/platform/tenants/[id]/parent-
// tenant.ts, which owns the write side - this file is deliberately
// GET-only, no write path, per the standing decision that this link
// stays platform-admin-configured, not tenant-editable). Renamed from
// weather-share.ts - see that file's own former comment/the platform
// route's new comment for the full "why" of the rename. Backs
// ConfigPage.tsx's existing "Currently using X's weather station"
// banner, unchanged in wording - only this file's URL/field names
// changed underneath it.
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

  const parent = await env.DB
    .prepare(
      `SELECT p.slug AS slug, p.name AS name
       FROM tenants t JOIN tenants p ON p.id = t.parent_tenant_id
       WHERE t.organization_id = ?`
    )
    .bind(result.membership.organizationId)
    .first<{ slug: string; name: string }>();

  return jsonResponse({ parentTenantSlug: parent?.slug ?? null, parentTenantName: parent?.name ?? null });
};
