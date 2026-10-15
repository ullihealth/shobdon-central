// Shared "which tenants are eligible to be chosen as a Parent Airfield"
// query - landing-page signup round. Used by BOTH
// functions/api/public/parent-airfields.ts (the public listing the
// signup form's dropdown reads) and functions/api/public/signup.ts
// (server-side validation of the submitted parentTenantId) so the two
// can never drift apart - a tenant that's eligible to be LISTED must
// always be exactly the same set a submission is VALIDATED against.
//
// Eligibility is data-driven, not a hardcoded slug blocklist (demo/
// newcustomer/etc.) - a tenant qualifies if it genuinely owns a real
// weather station (active_weather_provider = 'atc') or is already relied
// on as a parent by at least one other tenant (appears in some row's
// parent_tenant_id). Today that's exactly {Shobdon}, the one real
// station-owning tenant - confirmed against production data before
// writing this. Deliberately excludes venue_cafe tenants too (a café has
// no weather station of its own to be a parent FOR), and soft-deleted
// tenants (deleted_at).
import type { D1Database } from "./tenantAuth";

export interface EligibleParentTenant {
  id: number;
  slug: string;
  name: string;
  lat: number | null;
  lon: number | null;
}

export async function getEligibleParentTenants(db: D1Database): Promise<EligibleParentTenant[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, name, lat, lon FROM tenants
       WHERE deleted_at IS NULL
         AND tenant_type = 'airfield'
         AND (
           active_weather_provider = 'atc'
           OR id IN (SELECT DISTINCT parent_tenant_id FROM tenants WHERE parent_tenant_id IS NOT NULL)
         )
       ORDER BY name`
    )
    .all<EligibleParentTenant>();
  return results;
}
