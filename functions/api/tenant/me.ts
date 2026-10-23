// Lightweight "who am I / what's my role" endpoint for client-side role
// gating (RequireAuth.tsx's requireRole prop). Deliberately membership-
// gated only (requireTenant), not owner-gated - any authenticated tenant
// member needs to be able to learn their own role, including the ones
// who'll then get turned away from owner-only pages precisely because of
// what this endpoint tells them.

import { requireTenant, listUserMemberships, jsonResponse, type D1Database } from "../_utils/tenantAuth";
import { TERMS_VERSION } from "../_utils/termsVersion";
import { loadBillingContext } from "../_utils/billingContext";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MEDIA_PUBLIC_BASE_URL?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await requireTenant(request, env);
  if ("error" in result) return result.error;

  // Cross-tenant developer flag (functions/api/tenant/members/index.ts
  // already reads this same column to hide the developer's own row from
  // the members list) - deliberately a separate column from role, not a
  // tenant role itself, so it can gate /developertools independently of
  // whatever tenant role the developer's account happens to hold.
  // termsAcceptedAt backs RequireAuth.tsx's mandatory onboarding-terms
  // redirect - per-user, not per-tenant (see migration 0032's own
  // comment on why). termsAcceptedVersion (migration 0108, terms-
  // versioning round) is now part of that same check below - accepting
  // is only "done" if the stored version matches the CURRENT
  // TERMS_VERSION, so a user who accepted an earlier (or, for every
  // existing account, the old unversioned placeholder) text is
  // correctly treated as not-yet-accepted and re-prompted.
  const userRow = await env.DB
    .prepare("SELECT developer, termsAcceptedAt, termsAcceptedVersion FROM user WHERE id = ?")
    .bind(result.userId)
    .first<{ developer: number; termsAcceptedAt: string | null; termsAcceptedVersion: string | null }>();

  // memberships feeds the account/org switcher (AdminSidebar's
  // OrgSwitcher) - every org this user belongs to, not just the one the
  // current request resolved to.
  const memberships = await listUserMemberships(env.DB, result.userId);

  // cafeEntitled drives AdminSidebar's Cafe Media item (sidebarConfig.ts's
  // requireCafeEntitlement) - same live "entitled AND not trial-expired"
  // fact as isCurrentlyEntitled() in functions/api/public/display.ts,
  // read from the same tenant_displays row (migration 0034), not a
  // parallel setting. The route itself (/cafe-media) already self-gates
  // independently via CafeMediaPage.tsx's own /api/tenant/displays read
  // (shows FeatureUpsellPanel instead of the editor when unentitled) -
  // this field only needs to keep the sidebar link from pointing at
  // that dead end. No row at all (never onboarded/visited) is treated
  // as not entitled, same as displays.ts's own CafeMediaPage-facing read.
  const cafeDisplay = await env.DB
    .prepare(
      `SELECT td.entitled AS entitled, td.entitlement_trial_expires_at AS entitlementTrialExpiresAt
       FROM tenant_displays td
       JOIN tenants t ON t.id = td.tenant_id
       WHERE t.organization_id = ? AND td.slug = 'cafe-tv'`
    )
    .bind(result.membership.organizationId)
    .first<{ entitled: number; entitlementTrialExpiresAt: string | null }>();
  const cafeEntitled =
    !!cafeDisplay?.entitled &&
    !(cafeDisplay.entitlementTrialExpiresAt && new Date(cafeDisplay.entitlementTrialExpiresAt).getTime() <= Date.now());

  // This tenant's own subdomain (tenants.subdomain, e.g.
  // "gyroplane-train.airfieldcentral.com") - Header.tsx's logo link on
  // /config needs this to tell whether the CURRENT hostname is actually
  // this tenant's own subdomain before linking to '/' (see that file's
  // own comment: '/' only ever renders the right tenant's dashboard on
  // that exact host - resolveTenantHost.ts's Host-based resolution has
  // no session/cookie fallback). A freshly-provisioned tenant always has
  // a real, non-null subdomain value here (both onboard.ts and trial-
  // signup.ts set it at INSERT time) even when nothing is actually
  // reachable at that hostname yet (DNS/custom-domain provisioning is a
  // separate, still-manual step - see onboard.ts's own comment) - this
  // field reports the intended host, not a live/reachable guarantee.
  // tenantType (migration 0090, venue/café onboarding round) added to
  // this SAME existing query rather than a new one - same "explicit
  // SELECT list, explicit returned object" endpoint shape this file
  // already has, and the exact known field-stripping trap flagged during
  // investigation: adding the column to tenants alone does nothing here
  // without this addition AND the matching addition to the returned
  // object below. Drives AdminSidebar.tsx's sidebarConfig.ts
  // hideForTenantType gate.
  // Abandoned-checkout round - subscriptionStatus/pendingPlan back
  // RequireAuth.tsx's new "Complete your subscription" gate. 'pending'
  // is a status ONLY functions/api/public/signup.ts ever writes (see
  // that file's own comment) - no pre-existing/comped tenant can ever
  // have it, so this gate is airtight without a new column.
  const tenantRow = await env.DB
    .prepare("SELECT id, subdomain, active, tenant_type AS tenantType, subscription_status AS subscriptionStatus, subscription_notes AS pendingPlan FROM tenants WHERE organization_id = ?")
    .bind(result.membership.organizationId)
    .first<{ id: number; subdomain: string | null; active: number; tenantType: string; subscriptionStatus: string; pendingPlan: string | null }>();

  // Tenant-facing TV schedule round (migration 0115) - drives
  // sidebarConfig.ts's own requireTvScheduleBox gate (same pattern
  // cafeEntitled already establishes above): the sidebar item is hidden
  // entirely unless this tenant has at least one box a platform admin
  // has explicitly linked (pi_units.tenant_id) AND that box has checked
  // in at least once (tv_schedule_last_seen_at IS NOT NULL) - a linked
  // box that's never actually polled yet has nothing to show.
  const hasTvScheduleBox = tenantRow
    ? !!(await env.DB
        .prepare("SELECT 1 FROM pi_units WHERE tenant_id = ? AND tv_schedule_last_seen_at IS NOT NULL LIMIT 1")
        .bind(tenantRow.id)
        .first())
    : false;

  // Subscription block for the "subscription not active" page: which plan it
  // would sell, whether payment is already in (still suspended = awaiting a
  // developer Resume), and whether checkout still needs consent steps. Plus the
  // tenant's logo, because a suspended tenant's PUBLIC config is offline.
  const billing = await loadBillingContext(env.DB, result.membership.organizationId, result.userId);
  const logoRow = await env.DB
    .prepare("SELECT logo_r2_key AS logoR2Key FROM tenants WHERE organization_id = ?")
    .bind(result.membership.organizationId)
    .first<{ logoR2Key: string | null }>();

  return jsonResponse({
    role: result.membership.role,
    organizationSlug: result.membership.slug,
    organizationName: result.membership.name,
    isDeveloper: !!userRow?.developer,
    hasAcceptedTerms: !!userRow?.termsAcceptedAt && userRow.termsAcceptedVersion === TERMS_VERSION,
    // Stripe groundwork Part G - raw values (not just the boolean above)
    // so HelpPage.tsx can show THIS user's own accepted version/date,
    // including a stale one (accepted an OLDER version, not yet the
    // current TERMS_VERSION) - the boolean alone can't distinguish
    // "never accepted" from "accepted an old version".
    termsAcceptedAt: userRow?.termsAcceptedAt ?? null,
    termsAcceptedVersion: userRow?.termsAcceptedVersion ?? null,
    // false = this tenant is SUSPENDED (tenants.active = 0): the app locks the
    // admin area to My Account for non-developers (AdminLayout.tsx) - the
    // server enforces it independently (tenantAuth.ts requireTenant). Missing
    // row = treated as active, never a lock.
    subscriptionActive: tenantRow ? !!tenantRow.active : true,
    logoUrl: logoRow?.logoR2Key && env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${logoRow.logoR2Key}` : null,
    subscription: billing
      ? {
          planId: billing.plan,
          paymentReceived: billing.paymentReceived,
          hasStripeCustomer: !!billing.stripeCustomerId,
          includesMediaBox: billing.includesMediaBox,
          hasMediaBoxConsent: billing.hasMediaBoxConsent,
        }
      : null,
    subscriptionPending: tenantRow?.subscriptionStatus === "pending",
    pendingPlan: tenantRow?.subscriptionStatus === "pending" ? tenantRow?.pendingPlan ?? null : null,
    cafeEntitled,
    subdomain: tenantRow?.subdomain ?? null,
    // Defaults to 'airfield' (matching the column's own DEFAULT) rather
    // than null - AdminSidebar.tsx's TenantType is a plain two-value
    // union with no "unknown" state to represent a genuinely-missing row.
    tenantType: tenantRow?.tenantType === "venue_cafe" ? "venue_cafe" : "airfield",
    hasTvScheduleBox,
    memberships,
  });
};
