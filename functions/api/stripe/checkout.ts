// Authenticated POST /api/stripe/checkout - Stripe groundwork Parts
// B/C. Creates a Stripe Checkout Session (mode=subscription) for the
// CALLER'S OWN tenant, derived from their session - never from a tenant
// id in the request body, per the go-ahead's explicit instruction. Same
// no-SDK, plain-fetch pattern as functions/api/stripe/webhook.ts (see
// that file's own comment for why no `stripe` npm package).
//
// This is the piece that didn't already exist before this round -
// webhook.ts's own comment confirms client_reference_id was previously
// only ever populated by manually-created Stripe Payment Links (Tiger's
// own, made directly in the Stripe dashboard), not a dynamically-created
// Checkout Session. This route is what makes the new paid-signup (Part
// B) and activation-link (Part C) flows both work through the SAME
// webhook-driven provisioning path webhook.ts already handles - no
// change needed there at all.
import { getSessionUserId, resolveTenantMembership, jsonResponse, type D1Database } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_PACK: string;
  STRIPE_PRICE_PILOT_APP: string;
  STRIPE_API_BASE_URL?: string;
}

// Media Screen deliberately excluded - see functions/api/public/
// signup.ts's own top comment (single-subscription-per-tenant, Pack-
// required, no safe way to sell it alone through this endpoint today).
const VALID_PLANS = ["pack", "pilotApp"] as const;
type Plan = (typeof VALID_PLANS)[number];

function priceEnvKeyForPlan(plan: Plan, env: Env): string {
  return plan === "pack" ? env.STRIPE_PRICE_PACK : env.STRIPE_PRICE_PILOT_APP;
}

interface StripeCheckoutSession {
  id: string;
  url: string;
}

// The one outbound Stripe call this route makes, same posture as
// webhook.ts's own retrieveSubscription - plain fetch, Bearer token,
// application/x-www-form-urlencoded body (Stripe's REST API accepts
// this for every endpoint, including nested fields via bracket
// notation - confirmed against Stripe's own API reference, not
// assumed).
async function createCheckoutSession(
  env: Env,
  params: {
    priceId: string;
    clientReferenceId: string;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
  }
): Promise<StripeCheckoutSession | { error: string }> {
  const base = env.STRIPE_API_BASE_URL || "https://api.stripe.com";
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", params.priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("client_reference_id", params.clientReferenceId);
  form.set("customer_email", params.customerEmail);
  form.set("allow_promotion_codes", "true");
  form.set("success_url", params.successUrl);
  form.set("cancel_url", params.cancelUrl);

  const response = await fetch(`${base}/v1/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const body = (await response.json().catch(() => null)) as (StripeCheckoutSession & { error?: { message?: string } }) | null;
  if (!response.ok || !body) {
    return { error: body?.error?.message || "Stripe checkout session creation failed" };
  }
  return body;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as { plan?: unknown; activationToken?: unknown } | null;
  const plan = typeof body?.plan === "string" && (VALID_PLANS as readonly string[]).includes(body.plan) ? (body!.plan as Plan) : null;
  if (!plan) return jsonResponse({ error: `plan must be one of: ${VALID_PLANS.join(", ")}` }, 400);
  const activationToken = typeof body?.activationToken === "string" && body.activationToken ? body.activationToken : null;

  // Tenant resolved from the session's own membership, never from the
  // browser - same requireTenant-backing helper every other tenant-
  // scoped route uses (resolveTenantMembership(db, userId, null) ==
  // "the caller's own, only, membership" - see that function's own
  // comment).
  const membership = await resolveTenantMembership(env.DB, userId, null);
  if (!membership) return jsonResponse({ error: "No tenant membership found for this account" }, 403);

  const userRow = await env.DB.prepare("SELECT email FROM user WHERE id = ?").bind(userId).first<{ email: string }>();
  if (!userRow?.email) return jsonResponse({ error: "Account email not found" }, 500);

  const priceId = priceEnvKeyForPlan(plan, env);
  if (!priceId) return jsonResponse({ error: "Pricing is not configured for this plan yet - please contact support" }, 500);

  // Part C - existing-tenant activation. Re-validated here (not just on
  // /activate/:token's own GET) since THIS is the request that actually
  // spends the token - a token is "used" the moment a Checkout Session
  // is created from it (see the migration's own comment), never before,
  // so re-checking expiry/used_at/tenant-match right before that exact
  // moment is the real enforcement, not UX only. tenant-mismatch is the
  // "wrong-tenant user" case: a token generated for tenant X redeemed by
  // someone logged in as tenant Y's own member must fail, not silently
  // activate the wrong tenant.
  let activationLinkTenantId: number | null = null;
  if (activationToken) {
    const link = await env.DB
      .prepare("SELECT tenant_id AS tenantId, expires_at AS expiresAt, used_at AS usedAt FROM activation_links WHERE token = ?")
      .bind(activationToken)
      .first<{ tenantId: number; expiresAt: string; usedAt: string | null }>();
    if (!link) return jsonResponse({ error: "This activation link is not valid" }, 404);
    if (link.usedAt) return jsonResponse({ error: "This activation link has already been used" }, 409);
    if (new Date(link.expiresAt).getTime() < Date.now()) return jsonResponse({ error: "This activation link has expired" }, 410);
    activationLinkTenantId = link.tenantId;
  }

  // Tenant's own real subdomain, resolved server-side - never a
  // caller-supplied redirect target (open-redirect risk), matching this
  // route's own "never trust a tenant id from the browser" posture for
  // the destination too.
  const tenantRow = await env.DB.prepare("SELECT subdomain FROM tenants WHERE organization_id = ?").bind(membership.organizationId).first<{ subdomain: string | null }>();
  const subdomain = tenantRow?.subdomain || `${membership.slug}.airfieldcentral.com`;
  const successUrl = `https://${subdomain}/?welcome=1`;
  const cancelUrl = `https://${subdomain}/`;

  // client_reference_id must be the tenant's own INTEGER id (what
  // webhook.ts's findTenantByClientReferenceId expects, matching how
  // Tiger's manually-created Payment Links were already configured -
  // see that file's own comment), not organizationId.
  const tenantIdRow = await env.DB.prepare("SELECT id FROM tenants WHERE organization_id = ?").bind(membership.organizationId).first<{ id: number }>();
  if (!tenantIdRow) return jsonResponse({ error: "Tenant not found" }, 404);

  if (activationLinkTenantId !== null && activationLinkTenantId !== tenantIdRow.id) {
    return jsonResponse({ error: "This activation link was issued for a different tenant" }, 403);
  }

  const session = await createCheckoutSession(env, {
    priceId,
    clientReferenceId: String(tenantIdRow.id),
    customerEmail: userRow.email,
    successUrl,
    cancelUrl,
  });

  if ("error" in session) return jsonResponse({ error: session.error }, 502);

  // Marked used only now - after the Checkout Session genuinely exists,
  // not before (see migration 0111's own comment). A failed Stripe call
  // above leaves the token untouched, so the admin can simply retry the
  // same link rather than needing a new one for a transient failure.
  if (activationToken) {
    await env.DB.prepare("UPDATE activation_links SET used_at = ? WHERE token = ?").bind(new Date().toISOString(), activationToken).run();
  }

  return jsonResponse({ ok: true, checkoutUrl: session.url });
};
