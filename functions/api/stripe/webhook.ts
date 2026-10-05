// Stripe webhook - Airfield Pack round, Phase B. TEST MODE ONLY so far:
// nothing here has been pointed at a live Stripe account or a real
// webhook endpoint yet (that's a manual step Jeff does after reviewing
// this). Public, UNAUTHENTICATED by Cloudflare Access/BetterAuth's own
// standards - Stripe itself is the only legitimate caller, and the only
// authentication that matters is the signature check below.
//
// No `stripe` npm package used, deliberately - this project has zero
// npm dependencies for any of its other Pages Functions (every other
// route is plain fetch/D1/Web Crypto), and the two things the Stripe
// SDK would otherwise buy here - signature verification and one REST
// call - are both small enough to do directly: HMAC-SHA256 via the
// runtime's own Web Crypto (`crypto.subtle`, available in Workers with
// no compat flag) for the signature, and a plain `fetch()` with a
// Bearer token for the one subscription lookup this needs. Avoids
// pulling in a dependency whose own Workers-compat story (bundler
// externals, its internal fetch/crypto auto-detection) is one more
// thing that could silently misbehave under `wrangler pages dev`
// specifically, for a single webhook route.
//
// Events handled (all five the brief asks for):
//   - checkout.session.completed: the ONLY event carrying
//     client_reference_id (set to the tenant's own id by whichever of
//     Tiger's per-product Payment Links was used), so this is the one
//     event that can identify a brand-new tenant<->Stripe relationship
//     from nothing. Stores stripe_customer_id/stripe_subscription_id on
//     that tenant, fetches the resulting subscription (one REST call -
//     Checkout Session webhook payloads don't carry price/line-item
//     data, unlike Invoice and Subscription payloads, which do), maps
//     its price to a product, and grants that product's entitlement -
//     see applyEntitlementForProduct below. This is "on successful
//     payment" (B5) for a BRAND NEW subscription.
//   - invoice.paid: fires for every successful charge INCLUDING the
//     first one, but unlike checkout.session.completed it carries no
//     client_reference_id - only usable for tenants checkout.session.
//     completed has already matched (by subscription id, already
//     stored by then in the normal case). Treated here purely as
//     renewal bookkeeping: re-affirms subscription_status='active'
//     (recovers a tenant that had drifted to 'past_due') and logs a
//     history row. Deliberately does NOT redo entitlement/flag-setting
//     - those are already correct from the original checkout, and
//     re-running that logic on every renewal risks re-litigating the
//     "Media Screen without the Pack" edge case on a billing event that
//     has nothing to do with it.
//   - invoice.payment_failed: 'past_due', history only, zero flag
//     changes (B6 - Stripe's own retry emails/Smart Retries are what
//     eventually produce a real invoice.paid or subscription.deleted;
//     nothing here adds a parallel timer of our own).
//   - customer.subscription.deleted: the authoritative cancellation
//     signal. 'cancelled', and - unlike invoice.payment_failed - DOES
//     turn off flags, but only the ones tied to the cancelled
//     subscription's own product (read from the event's own payload,
//     which already includes items/price - no REST call needed here).
//     Never touches tenants.active - suspension is a separate, manual
//     decision (see PlatformTenantsPage.tsx's Suspend button), not
//     something a billing event should drive on its own.
//   - customer.subscription.updated: fires for many unrelated changes
//     (trial-ending, pause/resume, metadata edits, the same status
//     transition subscription.deleted ALSO reports). Everything this
//     brief actually specifies behaviourally (active/past_due/cancelled
//     and which flags move) is already fully covered by the four
//     events above. Rather than guess at duplicate logic for whatever
//     else might trigger this event, it's accepted and logged (tenant
//     matched, one observational subscription_history row recording
//     the raw Stripe status) with no status/flag changes of its own -
//     see handleSubscriptionUpdated below. Flagged in this round's own
//     report as a deliberately narrow interpretation, not an oversight.
//
// Idempotency: every event id is INSERT OR IGNORE'd into stripe_events
// first (migration 0107) - a second delivery of the same event (Stripe
// retries aggressively) finds its id already present, does nothing, and
// still returns 200 (so Stripe stops retrying) rather than re-applying
// whatever that event did the first time.
//
// Tenant matching is NEVER by email, exactly per the brief - only
// client_reference_id (checkout.session.completed) or an exact
// stripe_subscription_id/stripe_customer_id match (every other event).
// An unmatched tenant logs one line with no personal data (just the
// Stripe id itself, which is already an opaque, non-personal token) and
// returns 200 with no DB writes at all.
//
// KNOWN SCHEMA LIMITATION (see this round's own report): tenants has a
// single stripe_subscription_id column. A tenant that buys more than
// one product as genuinely separate Stripe subscriptions (e.g. the Pack
// via one Payment Link, Media Screen added later via a second, separate
// Payment Link) will have the second subscription's id overwrite the
// first's on the tenant row - a later event for the FIRST subscription
// (e.g. its own cancellation) would then fail to match this tenant at
// all and silently no-op. Fine for this round (one product per tenant
// to start, Tiger included) - flagged, not fixed, since the brief's own
// schema (B1) is explicitly single-id-per-tenant.

import { jsonResponse } from "../_utils/tenantAuth";

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
}) => Response | Promise<Response>;

// Narrower than tenantAuth.ts's own D1Database - adds `meta.changes` to
// run()'s return type (needed below to tell an INSERT OR IGNORE's "I
// inserted a fresh row" apart from "that id was already present"),
// which that shared type deliberately leaves out since most callers
// never need it. Same "per-file local D1Database type" convention every
// other route in this codebase already follows for its own extra
// needs (see e.g. resolveTenantHost.ts's own minimal version).
type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ success: boolean; meta: { changes: number } }>;
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

interface Env {
  DB: D1Database;
  STRIPE_WEBHOOK_SECRET: string;
  // Not in the brief's own B1-B4 list - added because checkout.session.
  // completed's webhook payload has no price/line-item data of its own
  // (see the file-level comment above), so determining which product
  // was bought on that event means one authenticated REST call to
  // Stripe to retrieve the resulting subscription. Test-mode secret key
  // only, same "name only, never logged" posture as every other secret
  // here.
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_PACK: string;
  STRIPE_PRICE_PILOT_APP: string;
  STRIPE_PRICE_MEDIA_SCREEN: string;
  // Test-only escape hatch, not a secret and not part of the brief's own
  // env var list: lets scripts/stripe-webhook.test.mjs point
  // retrieveSubscription() at a local stub instead of the real Stripe
  // API, so that suite never makes a genuine network call (this
  // project's whole testing posture is real HTTP against a local
  // `wrangler pages dev`, never a live external service). Left unset in
  // every real environment, where it defaults to the real API below.
  STRIPE_API_BASE_URL?: string;
}

type Product = "pack" | "pilotApp" | "mediaScreen";

function productForPriceId(priceId: string | null | undefined, env: Env): Product | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_PACK) return "pack";
  if (priceId === env.STRIPE_PRICE_PILOT_APP) return "pilotApp";
  if (priceId === env.STRIPE_PRICE_MEDIA_SCREEN) return "mediaScreen";
  return null;
}

// First recognised price among a subscription/invoice's line items -
// every Payment Link this round sells is single-price, so "first match"
// and "the only match" are the same thing in practice; written as a
// search rather than items[0] only so a subscription with the reserved
// AirfieldCentral/platform line items ever added alongside it in future
// still resolves correctly instead of silently reading the wrong index.
function productForLineItems(items: Array<{ price?: { id?: string } | null }> | undefined, env: Env): Product | null {
  for (const item of items ?? []) {
    const product = productForPriceId(item.price?.id, env);
    if (product) return product;
  }
  return null;
}

interface TenantRow {
  id: number;
  organizationId: string | null;
  dashboardEnabled: number;
  mobileEnabled: number;
}

async function findTenantByClientReferenceId(db: D1Database, clientReferenceId: string | null | undefined): Promise<TenantRow | null> {
  const tenantId = Number(clientReferenceId);
  if (!Number.isInteger(tenantId)) return null;
  return db
    .prepare("SELECT id, organization_id AS organizationId, dashboard_enabled AS dashboardEnabled, mobile_enabled AS mobileEnabled FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<TenantRow>();
}

// Every later event (B3: "For all later events, look up tenant by
// stripe_subscription_id/stripe_customer_id") - subscription id first
// since it's the more specific of the two, customer id as a fallback
// for the rare case a tenant's stripe_customer_id was stored but its
// stripe_subscription_id was later overwritten by a second subscription
// (see the schema-limitation note above).
async function findTenantByStripeIds(
  db: D1Database,
  { subscriptionId, customerId }: { subscriptionId?: string | null; customerId?: string | null }
): Promise<TenantRow | null> {
  if (subscriptionId) {
    const bySub = await db
      .prepare("SELECT id, organization_id AS organizationId, dashboard_enabled AS dashboardEnabled, mobile_enabled AS mobileEnabled FROM tenants WHERE stripe_subscription_id = ?")
      .bind(subscriptionId)
      .first<TenantRow>();
    if (bySub) return bySub;
  }
  if (customerId) {
    const byCustomer = await db
      .prepare("SELECT id, organization_id AS organizationId, dashboard_enabled AS dashboardEnabled, mobile_enabled AS mobileEnabled FROM tenants WHERE stripe_customer_id = ?")
      .bind(customerId)
      .first<TenantRow>();
    if (byCustomer) return byCustomer;
  }
  return null;
}

async function appendSubscriptionHistory(db: D1Database, tenantId: number, status: string, note: string, now: string): Promise<void> {
  await db
    .prepare("INSERT INTO subscription_history (tenant_id, status, note, changed_by_user_id, changed_at) VALUES (?, ?, ?, 'stripe-webhook', ?)")
    .bind(tenantId, status, note, now)
    .run();
}

async function setSubscriptionStatus(db: D1Database, tenantId: number, status: string, note: string, now: string): Promise<void> {
  await db.prepare("UPDATE tenants SET subscription_status = ?, updated_at = ? WHERE id = ?").bind(status, now, tenantId).run();
  await appendSubscriptionHistory(db, tenantId, status, note, now);
}

// B5 - grants exactly one product's entitlement. Media Screen's own
// "only if the tenant already has the Pack" rule lives here, as does
// its "otherwise record it and flag it" fallback: a subscription_
// history note so it's visible in /platform/tenants's own history list
// (not just this round's written report), with subscription_status
// still moving to 'active' regardless - the PAYMENT genuinely
// succeeded, it's only the entitlement application that's withheld.
async function applyEntitlementForProduct(db: D1Database, tenant: TenantRow, product: Product, now: string): Promise<void> {
  if (product === "pack") {
    await db.prepare("UPDATE tenants SET dashboard_enabled = 1, mobile_enabled = 1, updated_at = ? WHERE id = ?").bind(now, tenant.id).run();
    return;
  }
  if (product === "pilotApp") {
    await db.prepare("UPDATE tenants SET mobile_enabled = 1, updated_at = ? WHERE id = ?").bind(now, tenant.id).run();
    return;
  }
  // mediaScreen
  const hasPack = !!tenant.dashboardEnabled;
  if (!hasPack) {
    await appendSubscriptionHistory(
      db,
      tenant.id,
      "active",
      "Stripe: Media Screen payment received, but this tenant does not have the Airfield Pack - entitlement NOT applied. Needs manual follow-up.",
      now
    );
    return;
  }
  const result = await db
    .prepare("UPDATE tenant_displays SET entitled = 1, updated_at = ? WHERE tenant_id = ? AND slug = 'cafe-tv'")
    .bind(now, tenant.id)
    .run();
  if (result.meta.changes === 0) {
    await appendSubscriptionHistory(
      db,
      tenant.id,
      "active",
      "Stripe: Media Screen payment received, but this tenant has no cafe-tv display row to entitle - entitlement NOT applied. Needs manual follow-up.",
      now
    );
  }
}

// B6's cancellation half - the mirror image of applyEntitlementForProduct
// above, minus the Media-Screen/no-Pack special case (switching
// something off is never gated on another flag's state the way turning
// it on is).
async function revokeEntitlementForProduct(db: D1Database, tenant: TenantRow, product: Product, now: string): Promise<void> {
  if (product === "pack") {
    await db.prepare("UPDATE tenants SET dashboard_enabled = 0, mobile_enabled = 0, updated_at = ? WHERE id = ?").bind(now, tenant.id).run();
    return;
  }
  if (product === "pilotApp") {
    await db.prepare("UPDATE tenants SET mobile_enabled = 0, updated_at = ? WHERE id = ?").bind(now, tenant.id).run();
    return;
  }
  await db.prepare("UPDATE tenant_displays SET entitled = 0, updated_at = ? WHERE tenant_id = ? AND slug = 'cafe-tv'").bind(now, tenant.id).run();
}

// Stripe-Signature header: "t=<unix ts>,v1=<hex hmac>[,v1=<hex hmac>...]"
// (a second v1 only appears during Stripe's own documented secret-
// rotation window) over `${timestamp}.${rawBody}`, HMAC-SHA256 keyed on
// the webhook signing secret. 5-minute tolerance matches the Stripe
// SDK's own default (constructEvent's DEFAULT_TOLERANCE) - defends
// against a captured, replayed request outside that window even though
// this is already HTTPS-only and secret-keyed.
async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  let timestamp = "";
  const candidateSignatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=");
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) candidateSignatures.push(value);
  }
  if (!timestamp || candidateSignatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expectedHex = [...new Uint8Array(signatureBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return candidateSignatures.some((candidate) => timingSafeEqual(candidate, expectedHex));
}

// Workers has no Node `crypto.timingSafeEqual` - a manual constant-time
// comparison (length check first so unequal lengths don't leak timing
// either, then XOR every byte unconditionally rather than short-
// circuiting) for the same reason the Stripe SDK itself doesn't use a
// plain `===` here.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

interface StripeSubscriptionItem {
  price?: { id?: string } | null;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  items: { data: StripeSubscriptionItem[] };
}

// The one outbound Stripe call this route makes - see the Env.
// STRIPE_SECRET_KEY comment above for why. Plain fetch, not the SDK.
async function retrieveSubscription(subscriptionId: string, env: Env): Promise<StripeSubscription | null> {
  const base = env.STRIPE_API_BASE_URL || "https://api.stripe.com";
  const response = await fetch(`${base}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function handleCheckoutSessionCompleted(db: D1Database, env: Env, session: Record<string, unknown>, now: string): Promise<void> {
  const tenant = await findTenantByClientReferenceId(db, session.client_reference_id as string | null | undefined);
  if (!tenant) {
    // Safe log line only - the Stripe ids below are opaque tokens, not
    // personal data, and client_reference_id is a tenant id we chose
    // ourselves at Payment Link creation time, never an email.
    console.log(`[stripe-webhook] checkout.session.completed: no tenant matches client_reference_id=${session.client_reference_id}`);
    return;
  }

  const customerId = typeof session.customer === "string" ? session.customer : null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  await db
    .prepare("UPDATE tenants SET stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ? WHERE id = ?")
    .bind(customerId, subscriptionId, now, tenant.id)
    .run();

  let product: Product | null = null;
  if (subscriptionId) {
    const subscription = await retrieveSubscription(subscriptionId, env);
    product = productForLineItems(subscription?.items.data, env);
  }

  if (!product) {
    console.log(`[stripe-webhook] checkout.session.completed: tenant ${tenant.id} - could not resolve a known product from subscription ${subscriptionId}`);
    await setSubscriptionStatus(db, tenant.id, "active", "Stripe: checkout completed, but no recognised product price found on the subscription.", now);
    return;
  }

  // Re-read with the just-written stripe_customer_id/subscription_id in
  // place isn't needed - applyEntitlementForProduct only reads
  // dashboardEnabled/mobileEnabled, neither of which this UPDATE above
  // touched.
  await applyEntitlementForProduct(db, tenant, product, now);
  await setSubscriptionStatus(db, tenant.id, "active", `Stripe: checkout completed for ${product}.`, now);
}

async function handleInvoicePaid(db: D1Database, invoice: Record<string, unknown>, now: string): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const tenant = await findTenantByStripeIds(db, { subscriptionId, customerId });
  if (!tenant) {
    console.log(`[stripe-webhook] invoice.paid: no tenant matches subscription=${subscriptionId} customer=${customerId}`);
    return;
  }
  await setSubscriptionStatus(db, tenant.id, "active", "Stripe: invoice paid.", now);
}

async function handleInvoicePaymentFailed(db: D1Database, invoice: Record<string, unknown>, now: string): Promise<void> {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : null;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  const tenant = await findTenantByStripeIds(db, { subscriptionId, customerId });
  if (!tenant) {
    console.log(`[stripe-webhook] invoice.payment_failed: no tenant matches subscription=${subscriptionId} customer=${customerId}`);
    return;
  }
  // History only - no flag changes (B6). Stripe's own retry schedule
  // (Smart Retries / the account's configured retry rules) is what
  // decides what happens next, not a timer of ours.
  await setSubscriptionStatus(db, tenant.id, "past_due", "Stripe: invoice payment failed.", now);
}

async function handleSubscriptionDeleted(db: D1Database, env: Env, subscription: StripeSubscription, now: string): Promise<void> {
  const tenant = await findTenantByStripeIds(db, { subscriptionId: subscription.id, customerId: subscription.customer });
  if (!tenant) {
    console.log(`[stripe-webhook] customer.subscription.deleted: no tenant matches subscription=${subscription.id} customer=${subscription.customer}`);
    return;
  }
  const product = productForLineItems(subscription.items.data, env);
  if (product) {
    await revokeEntitlementForProduct(db, tenant, product, now);
    await setSubscriptionStatus(db, tenant.id, "cancelled", `Stripe: subscription cancelled (${product}) - entitlement switched off.`, now);
  } else {
    console.log(`[stripe-webhook] customer.subscription.deleted: tenant ${tenant.id} - could not resolve a known product, no flags changed`);
    await setSubscriptionStatus(db, tenant.id, "cancelled", "Stripe: subscription cancelled, but no recognised product price found - no flags changed.", now);
  }
}

// Deliberately narrow - see the file-level comment's explanation of why
// this event gets observational logging only, not status/flag changes.
async function handleSubscriptionUpdated(db: D1Database, subscription: StripeSubscription, now: string): Promise<void> {
  const tenant = await findTenantByStripeIds(db, { subscriptionId: subscription.id, customerId: subscription.customer });
  if (!tenant) {
    console.log(`[stripe-webhook] customer.subscription.updated: no tenant matches subscription=${subscription.id} customer=${subscription.customer}`);
    return;
  }
  await appendSubscriptionHistory(db, tenant.id, "active", `Stripe: subscription updated (status=${subscription.status}).`, now);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");
  const verified = await verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) return jsonResponse({ error: "Invalid signature" }, 400);

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const now = new Date().toISOString();

  // Idempotency (B2) - a second delivery of an event id already seen
  // changes 0 rows here; still 200, no further processing.
  const inserted = await env.DB
    .prepare("INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)")
    .bind(event.id, event.type, now)
    .run();
  if (inserted.meta.changes === 0) {
    return jsonResponse({ ok: true, duplicate: true });
  }

  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(env.DB, env, object, now);
      break;
    case "invoice.paid":
      await handleInvoicePaid(env.DB, object, now);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(env.DB, object, now);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(env.DB, env, object as unknown as StripeSubscription, now);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(env.DB, object as unknown as StripeSubscription, now);
      break;
    default:
      // Any other event type Stripe might send to this same endpoint
      // (if Jeff ever subscribes it to more events than the five this
      // round asks for) - already recorded in stripe_events above, just
      // not acted on.
      break;
  }

  return jsonResponse({ ok: true });
};
