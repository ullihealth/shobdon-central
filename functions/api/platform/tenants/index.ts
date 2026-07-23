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
  MEDIA_PUBLIC_BASE_URL?: string;
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
  hasPhysicalAtc: number;
  storageQuotaBytes: number;
  organizationId: string | null;
  logoR2Key: string | null;
  createdAt: string;
  subscriptionStatus: string;
  subscriptionNotes: string;
}

interface UsageRow {
  organizationId: string;
  totalBytes: number;
}

interface DisplayRow {
  id: number;
  tenantId: number;
  slug: string;
  name: string;
  templateId: string;
  active: number;
  entitled: number;
  entitlementTrialExpiresAt: string | null;
}

interface MemberRow {
  organizationId: string;
  id: string;
  role: string;
  createdAt: string;
  email: string;
  name: string;
}

interface SubscriptionHistoryRow {
  id: number;
  tenantId: number;
  status: string;
  note: string;
  changedByUserId: string | null;
  changedAt: string;
}

interface DeveloperUserRow {
  id: string;
  email: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requirePlatformAdmin(request, env);
  if ("error" in result) return result.error;

  const [{ results: tenants }, { results: usageRows }, { results: displayRows }, { results: memberRows }, { results: historyRows }, { results: developerRows }] =
    await Promise.all([
    env.DB
      .prepare(
        `SELECT id, slug, name, subdomain, active,
                weather_public AS weatherPublic, ops_public AS opsPublic,
                is_internal AS isInternal, has_physical_atc AS hasPhysicalAtc,
                storage_quota_bytes AS storageQuotaBytes,
                organization_id AS organizationId, logo_r2_key AS logoR2Key, created_at AS createdAt,
                subscription_status AS subscriptionStatus, subscription_notes AS subscriptionNotes
         FROM tenants ORDER BY created_at`
      )
      .all<TenantRow>(),
    // One grouped query rather than one usage lookup per tenant - avoids
    // an N+1 that'd otherwise scale with the number of tenants on this
    // page.
    env.DB.prepare("SELECT organizationId, SUM(sizeBytes) AS totalBytes FROM media_library GROUP BY organizationId").all<UsageRow>(),
    // Every tenant's displays (Part D active override + Part C café
    // entitlement, migration 0034) in one query, grouped below - same
    // N+1 avoidance as usageRows above, needed now that this page also
    // surfaces per-display controls, not just per-tenant ones.
    env.DB
      .prepare(
        `SELECT id, tenant_id AS tenantId, slug, name, template_id AS templateId, active, entitled,
                entitlement_trial_expires_at AS entitlementTrialExpiresAt
         FROM tenant_displays ORDER BY id`
      )
      .all<DisplayRow>(),
    // Same join shape already proven by functions/api/tenant/members/index.ts,
    // generalized across every org instead of one - grouped below by
    // organizationId exactly like usageByOrg above. u.developer = 0 filters
    // out the cross-tenant developer account, matching that same file's own
    // "display-only, not a permissions change" reasoning.
    env.DB
      .prepare(
        `SELECT m.organizationId AS organizationId, m.id AS id, m.role AS role, m.createdAt AS createdAt,
                u.email AS email, u.name AS name
         FROM member m JOIN user u ON u.id = m.userId
         WHERE u.developer = 0
         ORDER BY m.createdAt`
      )
      .all<MemberRow>(),
    // Migration 0043 - grouped below by tenant_id, same N+1 avoidance as
    // every other per-tenant query above. Ordered newest-first here
    // (unlike the others, which are chronological) since the detail
    // pane's own history list wants to read top-to-bottom as "most
    // recent change first," matching /platform/visits's own reverse-
    // chronological convention.
    env.DB
      .prepare(
        `SELECT id, tenant_id AS tenantId, status, note, changed_by_user_id AS changedByUserId, changed_at AS changedAt
         FROM subscription_history ORDER BY changed_at DESC`
      )
      .all<SubscriptionHistoryRow>(),
    // Resolves subscription_history.changed_by_user_id to an email for
    // display - scoped to developer=1 rather than every user, since
    // that column can only ever hold a platform admin's id (this whole
    // endpoint is requirePlatformAdmin-gated and the only writer,
    // functions/api/platform/tenants/[id].ts, always binds
    // result.userId, which requirePlatformAdmin already confirmed has
    // developer=1). A future Stripe-webhook writer would store a
    // non-user string here instead (e.g. 'stripe-webhook'), which
    // simply won't match any id in this map - handled below by falling
    // back to the raw id rather than erroring.
    env.DB.prepare("SELECT id, email FROM user WHERE developer = 1").all<DeveloperUserRow>(),
  ]);

  const usageByOrg = new Map(usageRows.map((row) => [row.organizationId, row.totalBytes]));
  const displaysByTenant = new Map<number, DisplayRow[]>();
  for (const row of displayRows) {
    const list = displaysByTenant.get(row.tenantId) ?? [];
    list.push(row);
    displaysByTenant.set(row.tenantId, list);
  }
  const membersByOrg = new Map<string, MemberRow[]>();
  for (const row of memberRows) {
    const list = membersByOrg.get(row.organizationId) ?? [];
    list.push(row);
    membersByOrg.set(row.organizationId, list);
  }
  const historyByTenant = new Map<number, SubscriptionHistoryRow[]>();
  for (const row of historyRows) {
    const list = historyByTenant.get(row.tenantId) ?? [];
    list.push(row);
    historyByTenant.set(row.tenantId, list);
  }
  const emailByUserId = new Map(developerRows.map((row) => [row.id, row.email]));

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
      hasPhysicalAtc: !!tenant.hasPhysicalAtc,
      storageQuotaBytes: tenant.storageQuotaBytes,
      usedBytes: (tenant.organizationId && usageByOrg.get(tenant.organizationId)) || 0,
      logoUrl: tenant.logoR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${tenant.logoR2Key}` : null,
      createdAt: tenant.createdAt,
      displays: (displaysByTenant.get(tenant.id) ?? []).map((display) => ({
        id: display.id,
        slug: display.slug,
        name: display.name,
        templateId: display.templateId,
        active: !!display.active,
        entitled: !!display.entitled,
        entitlementTrialExpiresAt: display.entitlementTrialExpiresAt,
      })),
      members: (tenant.organizationId ? membersByOrg.get(tenant.organizationId) : undefined)?.map((member) => ({
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        createdAt: member.createdAt,
      })) ?? [],
      subscriptionStatus: tenant.subscriptionStatus,
      subscriptionNotes: tenant.subscriptionNotes,
      subscriptionHistory: (historyByTenant.get(tenant.id) ?? []).map((entry) => ({
        id: entry.id,
        status: entry.status,
        note: entry.note,
        changedByEmail: entry.changedByUserId ? (emailByUserId.get(entry.changedByUserId) ?? entry.changedByUserId) : null,
        changedAt: entry.changedAt,
      })),
    })),
  });
};
