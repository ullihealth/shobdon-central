// POST /api/tenant/billing/checkout - owner/admin. "Activate subscription" with
// NO activation link: starts a Stripe Checkout Session for THIS tenant's plan
// (tenant resolved from the session/host by requireTenant, never from the body).
// Terms acceptance and (for plans with a Media Box) the Schedule 1 consent are
// required first - the client collects them inline via the existing
// /api/tenant/terms/accept and /api/tenant/media-box-consent/accept routes; this
// route re-checks them. Payment goes through the existing webhook, which grants
// entitlements but NEVER touches tenants.active: a suspended tenant stays
// suspended until a developer presses Resume.
import { requireOwner, jsonResponse, type D1Database } from "../../_utils/tenantAuth";
import { loadBillingContext } from "../../_utils/billingContext";
import { priceIdForPlan } from "../../_utils/billingPlan";
import { createCheckoutSession, isStripeFailure, type StripeEnv } from "../../_utils/stripeApi";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;
interface Env extends StripeEnv {
  DB: D1Database;
  STRIPE_PRICE_PACK?: string;
  STRIPE_PRICE_PILOT_APP?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireOwner(request, env);
  if ("error" in auth) return auth.error;
  const ctx = await loadBillingContext(env.DB, auth.membership.organizationId, auth.userId);
  if (!ctx) return jsonResponse({ error: "Tenant not found" }, 404);

  if (ctx.stripeSubscriptionId && ctx.subscriptionStatus === "active") {
    return jsonResponse({ error: "A subscription is already active for this account.", code: "already_subscribed" }, 409);
  }
  if (!ctx.hasAcceptedTerms) return jsonResponse({ error: "Please accept the Customer Terms first.", code: "terms_required" }, 400);
  if (ctx.includesMediaBox && !ctx.hasMediaBoxConsent) {
    return jsonResponse({ error: "Please accept the Media Box loan terms first.", code: "media_box_consent_required" }, 400);
  }

  const priceId = priceIdForPlan(ctx.plan, env);
  if (!priceId) return jsonResponse({ error: "Pricing is not configured for this plan yet - please contact support" }, 500);

  const user = await env.DB.prepare("SELECT email FROM user WHERE id = ?").bind(auth.userId).first<{ email: string }>();
  if (!user?.email) return jsonResponse({ error: "Account email not found" }, 500);

  // Return to the host the user is on (they are logged in there). Derived from the
  // request itself, never from a caller-supplied URL (no open redirect).
  const origin = new URL(request.url).origin;
  const session = await createCheckoutSession(env, {
    priceId,
    tenantId: ctx.tenantId,
    customerEmail: user.email,
    successUrl: `${origin}/billing?checkout=success`,
    cancelUrl: `${origin}/billing?checkout=cancelled`,
    includesMediaBox: ctx.includesMediaBox,
  });
  if (isStripeFailure(session)) return jsonResponse({ error: session.error }, 502);
  return jsonResponse({ ok: true, checkoutUrl: session.url });
};
