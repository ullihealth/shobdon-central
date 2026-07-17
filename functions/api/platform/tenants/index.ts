// Platform-admin only: GET /api/platform/tenants - every tenant row,
// across every organization, with current media storage usage. Backs
// the /platform/tenants page (src/pages/PlatformTenantsPage.tsx),
// consolidating what was previously only reachable via raw D1 queries
// (see functions/api/_utils/mediaQuota.ts's and tenant/public-visibility.ts's
// own comments documenting those queries).
//
// requirePlatformAdmin, NOT requireDeveloper - the latter wraps
// requireTenant and so needs org-membership resolution (?org=/switcher
// cookie/earliest-membership default) to succeed FIRST, which would
// wrongly 403 a real platform admin whenever that resolution lands on
// an org they don't belong to. requirePlatformAdmin checks only session
// + user.developer, with zero dependency on org state - see its own
// comment in tenantAuth.ts for the disposable-account test that caught
// this distinction mattering in practice.
import { requirePlatformAdmin, jsonResponse, type D1Database } from "../../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
}

interface TenantRow {
  id: number;
  slug: string;
  name: string;
  subdomain: string;
  active: number;
  weatherPublic: number;
  opsPublic: number;
  isInternal: number;
  storageQuotaBytes: number;
  organizationId: string | null;
  createdAt: string;
}

interface UsageRow {
  organizationId: string;
  totalBytes: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const [{ results: tenants }, { results: usageRows }] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, slug, name, subdomain, active,
                weather_public AS weatherPublic, ops_public AS opsPublic,
                is_internal AS isInternal, storage_quota_bytes AS storageQuotaBytes,
                organization_id AS organizationId, created_at AS createdAt
         FROM tenants ORDER BY created_at`
      )
      .all<TenantRow>(),
    // One grouped query rather than one usage lookup per tenant - avoids
    // an N+1 that'd otherwise scale with the number of tenants on this
    // page.
    env.DB.prepare("SELECT organizationId, SUM(sizeBytes) AS totalBytes FROM media_library GROUP BY organizationId").all<UsageRow>(),
  ]);

  const usageByOrg = new Map(usageRows.map((row) => [row.organizationId, row.totalBytes]));

  return jsonResponse({
    tenants: tenants.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      subdomain: tenant.subdomain,
      active: !!tenant.active,
      weatherPublic: !!tenant.weatherPublic,
      opsPublic: !!tenant.opsPublic,
      isInternal: !!tenant.isInternal,
      storageQuotaBytes: tenant.storageQuotaBytes,
      usedBytes: (tenant.organizationId && usageByOrg.get(tenant.organizationId)) || 0,
      createdAt: tenant.createdAt,
    })),
  });
};
