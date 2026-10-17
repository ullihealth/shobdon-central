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

// Media Box consent round - same PLANS_WITH_MEDIA_BOX set as
// functions/api/public/signup.ts (only Pack includes the physical
// Reception Dashboard screen/Media Box). Duplicated rather than
// imported - no cross-boundary imports between functions/ and src/ or
// even between separate functions/ routes beyond shared _utils, per
// this project's existing convention (see e.g. TERMS_VERSION's own
// mirrored-constant pattern).
const PLANS_WITH_MEDIA_BOX: readonly string[] = ["pack"];

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
    includesMediaBox: boolean;
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
  // Media Box consent round - only shown when this checkout actually
  // includes a Media Box; a Pilot's-App-only checkout has no Schedule 1
  // card-charge authority to flag here.
  if (params.includesMediaBox) {
    form.set(
      "custom_text[submit][message]",
      "Your card will be saved for your subscription and, under the Media Box loan terms you accepted, for any Schedule 1 charge (max £99, with notice)."
    );
  }

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
  // Media Box consent round - for a brand-new paid signup (no
  // activationToken) this defaults from the plan itself (PLANS_WITH_
  // MEDIA_BOX, same as signup.ts); for an existing-tenant activation it
  // instead takes the LINK's own includes_media_box flag (set by the
  // platform admin who created it - see activation-link.ts's own
  // comment), since an activation link's Media Box status is decided
  // per-link, not purely by plan.
  let includesMediaBox = PLANS_WITH_MEDIA_BOX.includes(plan);
  if (activationToken) {
    const link = await env.DB
      .prepare("SELECT tenant_id AS tenantId, expires_at AS expiresAt, used_at AS usedAt, includes_media_box AS includesMediaBox FROM activation_links WHERE token = ?")
      .bind(activationToken)
      .first<{ tenantId: number; expiresAt: string; usedAt: string | null; includesMediaBox: number }>();
    if (!link) return jsonResponse({ error: "This activation link is not valid" }, 404);
    if (link.usedAt) return jsonResponse({ error: "This activation link has already been used" }, 409);
    if (new Date(link.expiresAt).getTime() < Date.now()) return jsonResponse({ error: "This activation link has expired" }, 410);
    activationLinkTenantId = link.tenantId;
    includesMediaBox = !!link.includesMediaBox;
  }

  // Tenant's own real subdomain, resolved server-side - never a
  // caller-supplied redirect target (open-redirect risk), matching this
  // route's own "never trust a tenant id from the browser" posture for
  // the destination too.
  const tenantRow = await env.DB.prepare("SELECT subdomain FROM tenants WHERE organization_id = ?").bind(membership.organizationId).first<{ subdomain: string | null }>();
  const subdomain = tenantRow?.subdomain || `${membership.slug}.airfieldcentral.com`;
  // Post-payment landing round: NOT the tenant's own "/" - the session
  // cookie set while filling in this form was scoped to the host the
  // browser was actually on (airfieldcentral.com for a brand-new paid
  // signup), and BetterAuth here has no cross-subdomain cookie config
  // (deliberately - see LoginPage.tsx's own comment on why that stays a
  // real tenant-isolation boundary, not something to relax). The visitor
  // genuinely arrives at this NEW subdomain logged out, so land them on
  // ITS login page instead of a dashboard they can't be authenticated
  // on - pre-filled email, welcome=1 for the copy/activation-poll
  // LoginPage.tsx's own welcome branch handles.
  const successUrl = `https://${subdomain}/login?welcome=1&email=${encodeURIComponent(userRow.email)}`;
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
    includesMediaBox,
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
