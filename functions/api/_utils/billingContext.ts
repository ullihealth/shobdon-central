// Shared lookups for the tenant billing routes and /api/tenant/me: one place
// that turns (tenant row + user row) into "what plan, is payment already in,
// does checkout still need terms / Media Box consent".
import { TERMS_VERSION } from "./termsVersion";
import { resolveTenantPlan, PLANS_WITH_MEDIA_BOX, type BillingPlan } from "./billingPlan";
import type { D1Database } from "./tenantAuth";

export interface BillingContext {
  tenantId: number;
  name: string;
  organizationId: string;
  active: boolean;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: BillingPlan;
  includesMediaBox: boolean;
  hasMediaBoxConsent: boolean;
  hasAcceptedTerms: boolean;
  // Stripe says paid (webhook set subscription_status 'active' + stored the
  // subscription id) but the tenant is still SUSPENDED: payment never resumes a
  // tenant, a developer does that by hand.
  paymentReceived: boolean;
}

export async function loadBillingContext(db: D1Database, organizationId: string, userId: string): Promise<BillingContext | null> {
  const t = await db
    .prepare(
      `SELECT id, name, active, dashboard_enabled AS dashboardEnabled, subscription_status AS subscriptionStatus,
              stripe_customer_id AS stripeCustomerId, stripe_subscription_id AS stripeSubscriptionId,
              media_box_consent_version AS mediaBoxConsentVersion
       FROM tenants WHERE organization_id = ?`
    )
    .bind(organizationId)
    .first<{
      id: number;
      name: string;
      active: number;
      dashboardEnabled: number;
      subscriptionStatus: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      mediaBoxConsentVersion: string | null;
    }>();
  if (!t) return null;
  const u = await db
    .prepare("SELECT termsAcceptedVersion FROM user WHERE id = ?")
    .bind(userId)
    .first<{ termsAcceptedVersion: string | null }>();
  const plan = await resolveTenantPlan(db, t.id, !!t.dashboardEnabled);
  return {
    tenantId: t.id,
    name: t.name,
    organizationId,
    active: !!t.active,
    subscriptionStatus: t.subscriptionStatus,
    stripeCustomerId: t.stripeCustomerId,
    stripeSubscriptionId: t.stripeSubscriptionId,
    plan,
    includesMediaBox: PLANS_WITH_MEDIA_BOX.includes(plan),
    hasMediaBoxConsent: t.mediaBoxConsentVersion === TERMS_VERSION,
    hasAcceptedTerms: u?.termsAcceptedVersion === TERMS_VERSION,
    paymentReceived: !t.active && t.subscriptionStatus === "active" && !!t.stripeSubscriptionId,
  };
}
