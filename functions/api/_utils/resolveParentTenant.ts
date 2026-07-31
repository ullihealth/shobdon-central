// Single shared "does this tenant inherit from a parent airfield, and
// if so what's the parent's identity" resolver (migration 0059,
// tenants.parent_tenant_id) - every domain that needs this checks in
// here, rather than each writing its own lookup. Read-time only: never
// writes anything, never touches a sub-tenant's own stored rows -
// callers use the returned identity to decide WHICH row to read for a
// given domain (e.g. runway_groups WHERE organizationId = ?), that's
// the entire contract. A sub-tenant's own data is never modified or
// deleted by linking/unlinking; it's just shadowed while linked.
//
// Two entry points, not one, because this codebase genuinely keys
// different tables by different identifiers on the SAME tenants row -
// some tables (runway_groups, gas_prices, ops_panel_state, club_theme,
// carousel_slots, ...) key by organization_id, others (weather_
// observations/latest_conditions, tenant_displays, tenant_api_keys) key
// by tenants.id. Both entry points resolve the exact same underlying
// row/parent link, just starting from whichever identifier the caller
// already has - resolveTenantHost.ts's own resolveTenantFromHost vs
// resolveOrganizationIdFromHost has the identical split for the
// identical reason, confirmed by inspection before designing this.

export type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

export interface EffectiveTenant {
  id: number;
  organizationId: string;
  slug: string;
  name: string;
  // false for a tenant with no parent set, or whose parent_tenant_id
  // points at a row that's gone missing (dangling - treated the same
  // as "no parent", never a crash) - in both cases every field above is
  // the CALLING tenant's own. true means every field above is the
  // PARENT's instead.
  isInherited: boolean;
}

interface TenantRow {
  id: number;
  organizationId: string;
  slug: string;
  name: string;
  parentTenantId: number | null;
}

async function loadTenantRow(db: D1Database, column: "id" | "organization_id", value: number | string): Promise<TenantRow | null> {
  return db
    .prepare(
      `SELECT id, organization_id AS organizationId, slug, name, parent_tenant_id AS parentTenantId FROM tenants WHERE ${column} = ?`
    )
    .bind(value)
    .first<TenantRow>();
}

function ownIdentity(row: TenantRow): EffectiveTenant {
  return { id: row.id, organizationId: row.organizationId, slug: row.slug, name: row.name, isInherited: false };
}

async function resolveFromOwnRow(db: D1Database, own: TenantRow | null, describedAs: string): Promise<EffectiveTenant> {
  // Every real caller already resolved this exact tenant moments
  // earlier (Host header or session membership) before calling in here
  // - a null own means the caller passed an identifier that doesn't
  // exist, an impossible state worth failing loudly on rather than
  // fabricating a fake identity for.
  if (!own) {
    throw new Error(`resolveParentTenant: no tenant found for ${describedAs}`);
  }
  if (!own.parentTenantId) return ownIdentity(own);

  const parent = await loadTenantRow(db, "id", own.parentTenantId);
  // Dangling parent_tenant_id (shouldn't happen given ON DELETE SET
  // NULL, but defensively: any edge case that left this pointing at a
  // gone row) fails safe to the tenant's own data, same as "no parent
  // set" - never a broken read.
  if (!parent) return ownIdentity(own);

  return { id: parent.id, organizationId: parent.organizationId, slug: parent.slug, name: parent.name, isInherited: true };
}

export async function resolveEffectiveTenantById(db: D1Database, tenantId: number): Promise<EffectiveTenant> {
  const own = await loadTenantRow(db, "id", tenantId);
  return resolveFromOwnRow(db, own, `tenants.id = ${tenantId}`);
}

export async function resolveEffectiveTenantByOrganizationId(db: D1Database, organizationId: string): Promise<EffectiveTenant> {
  const own = await loadTenantRow(db, "organization_id", organizationId);
  // Deliberately NOT the loud throw resolveFromOwnRow applies to the
  // tenants.id entry point above. An organizationId can legitimately
  // reach here without a matching tenants row: functions/api/public/
  // [tenant]/config.ts resolves it straight off organization.slug, and
  // nothing guarantees every organization row has a tenant (a signup
  // that created the org then failed before the tenant, an org made
  // outside the onboarding path). Before this round those callers just
  // queried by that organizationId and got back whatever existed -
  // normally nothing, i.e. an empty-but-valid config response. Throwing
  // here would turn that into a 500 on a public, unauthenticated
  // endpoint. Passing the caller's own organizationId straight back
  // through, isInherited false, keeps every downstream query
  // byte-identical to the pre-round behaviour instead. Verified against
  // both local and production D1 this round: zero organization rows
  // currently lack a tenant, so this is a guard against a future state,
  // not a bug being papered over.
  //
  // id is -1 rather than a real tenants.id because there genuinely
  // isn't one - safe today because no caller of THIS entry point reads
  // .id (publicConfig.ts and publicVisibilityForecast.ts both use
  // .organizationId/.isInherited only); anything that ever does needs to
  // handle -1 explicitly rather than binding it into a query.
  if (!own) return { id: -1, organizationId, slug: "", name: "", isInherited: false };
  return resolveFromOwnRow(db, own, `organization_id = ${organizationId}`);
}
