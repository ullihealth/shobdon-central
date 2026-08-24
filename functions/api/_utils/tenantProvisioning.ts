// Shared tenant/organization row-creation step for both onboarding
// paths - functions/api/platform/tenants/onboard.ts's invite-link flow
// and functions/api/public/trial-signup.ts's public self-serve flow.
// Deliberately narrow: only this row-creation step is shared. Slug
// resolution (onboard.ts's own random-fallback vs trial-signup.ts's
// always-required explicit choice), template cloning
// (cloneTenantTemplate, called separately by each caller with its own
// template-lookup), and everything downstream (invite+real-login vs a
// trial_signups record with no login) all stay in each caller, on
// purpose - those are genuinely different per flow, not duplicated.
//
// Reconciles a real discrepancy found during investigation: onboard.ts
// explicitly set icao_code=NULL/is_internal=0/logo_r2_key=NULL on its
// own tenants INSERT while trial-signup.ts's copy omitted them.
// Confirmed harmless in practice (tenants' own column defaults already
// produce the identical NULL/0/NULL either way - icao_code/logo_r2_key
// have no DEFAULT at all, is_internal DEFAULTs to 0), but two
// independently-maintained copies of the same INSERT is a real drift
// risk going forward, not a difference worth preserving deliberately -
// this file is now the one place that shape lives.
import type { D1Database } from "./tenantAuth";

export interface CreateTenantOrganizationParams {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  // Migration 0046_tenant_subdomain_confirmed.sql - true when a human
  // deliberately chose this slug (both callers' own explicit-slug path),
  // false only for onboard.ts's random tenant-XXXXXXXX fallback, which
  // OnboardInvitePage.tsx's own subdomain-picker step then requires
  // before anything else. trial-signup.ts's slug is always
  // human-chosen, so it always passes true.
  subdomainConfirmed: boolean;
  // Venue/café onboarding round (migration 0090) - optional and
  // defaults to 'airfield' below. Both callers can pass 'venue_cafe':
  // trial-signup.ts's own public venue_cafe branch, and (onboard-tool
  // fork round) onboard.ts's own tenantType-driven branch for a
  // developer deliberately creating a café-only tenant.
  tenantType?: "airfield" | "venue_cafe";
}

export type CreateTenantOrganizationResult =
  | { ok: true; organizationId: string; tenantId: number; subdomain: string }
  | { ok: false; reason: "slug_taken" };

// Both callers previously duplicated this exact object literal - a
// brand-new tenant hasn't uploaded a logo yet, so name-text-only is the
// sane starting point (DesignPage.tsx's Branding tab treats the two as
// mutually exclusive, not independently checkable).
const DEFAULT_BRAND_DISPLAY = JSON.stringify({
  main: { showLogo: false, showName: true, nameFontSize: "md" },
  cafe: { showLogo: false, showName: true, nameFontSize: "md" },
});

export async function createTenantOrganization(
  db: D1Database,
  params: CreateTenantOrganizationParams
): Promise<CreateTenantOrganizationResult> {
  const { slug, name, lat, lon, subdomainConfirmed, tenantType = "airfield" } = params;

  // Fast-path pre-check, same as both callers already did independently -
  // the try/catch below (around both INSERTs, on tenants.slug/
  // organization.slug's own UNIQUE constraints, migrations
  // 0002_organization_plugin.sql/0022_tenant_schema.sql) is the real
  // guarantee against a genuine race between two concurrent requests
  // choosing the same slug; this just avoids ever reaching it in the
  // common case.
  const existing = await db.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (existing) return { ok: false, reason: "slug_taken" };

  const now = new Date().toISOString();
  const organizationId = `org_${slug}`;
  const subdomain = `${slug}.airfieldcentral.com`;

  try {
    await db.prepare("INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)").bind(organizationId, name, slug, now).run();
  } catch {
    return { ok: false, reason: "slug_taken" };
  }

  try {
    await db
      .prepare(
        // full_buffer_gate_enabled explicit 1 (not left to the column's
        // own DEFAULT 0 from migration 0094) - SQLite has no ALTER
        // COLUMN...SET DEFAULT at all (confirmed directly: it's a
        // syntax error, not just unsupported), so the only way to
        // change what a NEW tenant gets without a full table-rebuild
        // migration is to stop relying on the column default here and
        // set it explicitly instead, same as active/is_internal/etc.
        // already are on this exact INSERT. Every real tenant-creation
        // path (trial-signup.ts's two branches, onboard.ts) routes
        // through this one shared function - see this file's own
        // header comment - so this is the single place that needs it.
        `INSERT INTO tenants (slug, name, subdomain, organization_id, icao_code, lat, lon, weather_public, ops_public, active, is_internal, logo_r2_key, brand_display_json, subdomain_confirmed, tenant_type, full_buffer_gate_enabled)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 0, 1, 0, NULL, ?, ?, ?, 1)`
      )
      .bind(slug, name, subdomain, organizationId, lat, lon, DEFAULT_BRAND_DISPLAY, subdomainConfirmed ? 1 : 0, tenantType)
      .run();
  } catch {
    // The organization row created just above is now orphaned - harmless
    // and invisible to any tenant-facing surface, same accepted tradeoff
    // both callers' own prior comments already documented, not worth a
    // rollback mechanism for this rare a race.
    return { ok: false, reason: "slug_taken" };
  }

  const tenantRow = await db.prepare("SELECT id FROM tenants WHERE slug = ?").bind(slug).first<{ id: number }>();
  if (!tenantRow) return { ok: false, reason: "slug_taken" };

  return { ok: true, organizationId, tenantId: tenantRow.id, subdomain };
}
