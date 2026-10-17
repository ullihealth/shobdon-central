// Integration test for functions/api/stripe/webhook.ts - Phase B7 of
// the Airfield Pack/Stripe groundwork round. Same posture as the other
// two files here: a Node built-in test (`node --test`), real HTTP
// requests against an already-running `wrangler pages dev`, no mocking
// framework.
//
// This suite ALSO starts a tiny local HTTP stub (below) standing in for
// api.stripe.com, on the port functions/api/stripe/webhook.ts's
// retrieveSubscription() is pointed at via STRIPE_API_BASE_URL in
// .dev.vars - see that file's own comment. Without it, the one real
// Stripe REST call checkout.session.completed makes (to read a
// subscription's price so it knows which product was bought) would
// need a genuine Stripe account; this way the whole suite runs with
// zero real network calls and zero real Stripe credentials, matching
// the task's own "test mode only, nothing live" constraint about as
// literally as possible - there IS no live Stripe account involved at
// all here, test mode or otherwise.
//
// Requires:
//   1. `wrangler pages dev dist --port 8788` already running separately,
//      with .dev.vars' STRIPE_WEBHOOK_SECRET/STRIPE_API_BASE_URL/price
//      vars set as this repo's .dev.vars already has them.
//   2. Local D1 seeded with tenant id 12 (test-onboard-weather) and its
//      cafe-tv display row (both already present in this repo's local
//      seed data) and the jeffthompson@europe.com developer user.
//
// Run with: node scripts/stripe-webhook.test.mjs (or npm test)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_EMAIL = 'jeffthompson@europe.com';
const WEBHOOK_SECRET = 'whsec_local_dev_only_dummy_secret'; // must match .dev.vars
const STUB_PORT = 8799; // must match .dev.vars' STRIPE_API_BASE_URL

// Sandbox round - read the real price ids straight out of .dev.vars
// instead of hardcoding them here. This file is never printed/logged
// (parsed in-process only), and a Node test script has no automatic
// access to Wrangler's own .dev.vars loading (that only happens inside
// the Worker runtime `wrangler pages dev` starts) - previously this
// file hardcoded its own placeholder price ids, which worked only
// because .dev.vars held the exact same placeholders; now that real
// sandbox price ids are in .dev.vars, hardcoding would silently
// desync and break every price-matching assertion below. Falls back to
// the original placeholders if .dev.vars is missing a key (CI/a fresh
// checkout before .dev.vars exists at all).
function readDevVar(key, fallback) {
  try {
    const contents = readFileSync('.dev.vars', 'utf8');
    const match = contents.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : fallback;
  } catch {
    return fallback;
  }
}

const STRIPE_PRICE_PACK = readDevVar('STRIPE_PRICE_PACK', 'price_1UNFGQPidShgOHShVaDq5CzF');
const STRIPE_PRICE_PILOT_APP = readDevVar('STRIPE_PRICE_PILOT_APP', 'price_1UNFGkPidShgOHSho400RtF5');
const STRIPE_PRICE_MEDIA_SCREEN = readDevVar('STRIPE_PRICE_MEDIA_SCREEN', 'price_1UNFH3PidShgOHShe8svQZ62');

// A dedicated test-only tenant, deliberately NOT 'newcustomer' (which
// scripts/dashboard-entitlement.test.mjs already mutates) - Node's test
// runner runs separate test FILES concurrently by default, so sharing a
// tenant row across the two suites would be a real race, not a
// theoretical one.
const TEST_TENANT_ID = 12; // test-onboard-weather
const TEST_SUBDOMAIN = 'test-onboard-weather.airfieldcentral.com';

function request(method, path, { headers = {}, body, rawBody } = {}) {
  const url = new URL(BASE_URL);
  const payload = rawBody ?? (body ? JSON.stringify(body) : undefined);
  const allHeaders = { ...headers };
  if (payload) {
    allHeaders['Content-Type'] = allHeaders['Content-Type'] || 'application/json';
    allHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path, method, headers: allHeaders, agent: false }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function signEvent(rawBody, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${rawBody}`;
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

let eventCounter = 0;
function uniqueId(prefix) {
  eventCounter += 1;
  return `${prefix}_test_${Date.now()}_${eventCounter}`;
}

async function postStripeEvent(eventBody, { secret = WEBHOOK_SECRET, signatureOverride } = {}) {
  const rawBody = JSON.stringify(eventBody);
  const signature = signatureOverride ?? signEvent(rawBody, secret);
  return request('POST', '/api/stripe/webhook', { rawBody, headers: { 'stripe-signature': signature } });
}

function checkoutSessionCompletedEvent({ clientReferenceId, customerId, subscriptionId }) {
  return {
    id: uniqueId('evt'),
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: String(clientReferenceId), customer: customerId, subscription: subscriptionId } },
  };
}

function invoicePaymentFailedEvent({ subscriptionId, customerId }) {
  return { id: uniqueId('evt'), type: 'invoice.payment_failed', data: { object: { subscription: subscriptionId, customer: customerId } } };
}

function subscriptionDeletedEvent({ subscriptionId, customerId, priceId }) {
  return {
    id: uniqueId('evt'),
    type: 'customer.subscription.deleted',
    data: { object: { id: subscriptionId, customer: customerId, status: 'canceled', items: { data: [{ price: { id: priceId } }] } } },
  };
}

// --- Local Stripe API stub (stands in for api.stripe.com) ---
const subscriptionsByid = new Map(); // subscriptionId -> { id, customer, status, items: { data: [{ price: { id } }] } }
let stubServer;

function registerStubSubscription(subscriptionId, customerId, priceId, defaultPaymentMethodId) {
  const subscription = {
    id: subscriptionId,
    customer: customerId,
    status: 'active',
    items: { data: [{ price: { id: priceId } }] },
  };
  // Media Box consent round - Checkout (mode=subscription) attaches the
  // collected card to the SUBSCRIPTION as its own default_payment_method
  // automatically (see webhook.ts's StripeSubscription comment) - only
  // set here when a test is specifically exercising the "copy it onto
  // the customer too" webhook behaviour; every pre-existing test
  // omitting this fourth argument keeps subscriptions with no such field
  // at all, same as before this round.
  if (defaultPaymentMethodId) subscription.default_payment_method = defaultPaymentMethodId;
  subscriptionsByid.set(subscriptionId, subscription);
}

// Media Box consent round - records of calls this suite can assert
// against. checkoutSessionRequests captures every POST /v1/checkout/
// sessions body (so a test can confirm checkout.ts's own custom_text
// field was/wasn't sent); customerUpdateRequests captures every POST
// /v1/customers/:id body (so a test can confirm webhook.ts's
// setCustomerDefaultPaymentMethod actually ran). Neither existed before
// this round - the stub previously only ever answered GET /v1/
// subscriptions/:id, since no test exercised checkout.ts's own
// create-session call or the webhook's new customer-update call.
const checkoutSessionRequests = [];
const customerUpdateRequests = [];

before(async () => {
  stubServer = http.createServer((req, res) => {
    if (req.method === 'GET') {
      const match = req.url?.match(/^\/v1\/subscriptions\/([^/?]+)/);
      const subscription = match ? subscriptionsByid.get(decodeURIComponent(match[1])) : null;
      if (!subscription) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'No such subscription' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(subscription));
      return;
    }

    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const params = new URLSearchParams(raw);

        if (req.url === '/v1/checkout/sessions') {
          checkoutSessionRequests.push(params);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: uniqueId('cs'), url: 'https://stub-checkout.test/session' }));
          return;
        }

        const customerMatch = req.url?.match(/^\/v1\/customers\/([^/?]+)/);
        if (customerMatch) {
          customerUpdateRequests.push({ customerId: decodeURIComponent(customerMatch[1]), params });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: decodeURIComponent(customerMatch[1]) }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Not found' } }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not found' } }));
  });
  await new Promise((resolve) => stubServer.listen(STUB_PORT, resolve));
});

after(async () => {
  await new Promise((resolve) => stubServer.close(resolve));
});

// --- Shared setup helpers against the real app (not the stub) ---
async function login() {
  const response = await request('GET', `/api/dev/local-login?email=${encodeURIComponent(TEST_EMAIL)}`);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie, 'local-login did not return a session cookie - is `wrangler pages dev` running?');
  return setCookie[0].split(';')[0];
}

async function getTenant(cookie) {
  const response = await request('GET', '/api/platform/tenants', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return response.json.tenants.find((t) => t.id === TEST_TENANT_ID);
}

async function patchTenant(cookie, body) {
  const response = await request('PATCH', `/api/platform/tenants/${TEST_TENANT_ID}`, { headers: { Cookie: cookie }, body });
  assert.equal(response.status, 200, `tenant PATCH setup/cleanup failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

async function patchCafeTvDisplay(cookie, cafeTvId, body) {
  const response = await request('PATCH', `/api/platform/tenants/${TEST_TENANT_ID}/displays/${cafeTvId}`, { headers: { Cookie: cookie }, body });
  assert.equal(response.status, 200, `display PATCH setup/cleanup failed: ${JSON.stringify(response.json)}`);
  return response.json;
}

// Resets the one tenant this whole suite shares back to a known,
// never-purchased-anything baseline before every scenario - the tenant
// row's stripe_customer_id/stripe_subscription_id are NOT reset (no API
// exposes clearing them, by design - see webhook.ts's own comment on
// why only the webhook itself ever writes them); each scenario instead
// uses its own brand-new synthetic subscription id, so a stale id left
// over from a previous scenario is simply never referenced again rather
// than needing to be cleared.
async function resetBaseline(cookie, cafeTvId) {
  await patchTenant(cookie, { dashboardEnabled: false, mobileEnabled: false, subscriptionStatus: 'trial' });
  await patchCafeTvDisplay(cookie, cafeTvId, { entitled: false });
}

test('Stripe webhook: Airfield Pack entitlement flow', async (t) => {
  const cookie = await login();
  const tenantBefore = await getTenant(cookie);
  const cafeTv = tenantBefore.displays.find((d) => d.slug === 'cafe-tv');
  assert.ok(cafeTv, 'expected test-onboard-weather to have a cafe-tv display row locally');

  // Snapshot every OTHER tenant up front, re-checked at the very end -
  // B7's "comped/existing tenants untouched" requirement.
  const othersBefore = (await request('GET', '/api/platform/tenants', { headers: { Cookie: cookie } })).json.tenants.filter(
    (t) => t.id !== TEST_TENANT_ID
  );

  try {
    await t.test('invalid signature is rejected with 400 and not recorded', async () => {
      const body = checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId: uniqueId('cus'), subscriptionId: uniqueId('sub') });
      const response = await postStripeEvent(body, { signatureOverride: 't=1,v1=0000000000000000000000000000000000000000000000000000000000000000' });
      assert.equal(response.status, 400);
    });

    await t.test('unmatched tenant (unknown client_reference_id) is accepted and changes nothing', async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
      const response = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: 999999999, customerId, subscriptionId }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      assert.equal(tenant.dashboardEnabled, false);
      assert.equal(tenant.mobileEnabled, false);
    });

    await t.test('checkout.session.completed: Pack grants dashboardEnabled AND mobileEnabled', async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
      const response = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      assert.equal(tenant.dashboardEnabled, true, 'Pack must enable dashboardEnabled');
      assert.equal(tenant.mobileEnabled, true, 'Pack must enable mobileEnabled');
      assert.equal(tenant.subscriptionStatus, 'active');
    });

    await t.test('checkout.session.completed copies the subscription default_payment_method onto the Stripe customer', async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      const paymentMethodId = uniqueId('pm');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK, paymentMethodId);
      const response = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));
      assert.equal(response.status, 200, JSON.stringify(response.json));
      const update = customerUpdateRequests.find((u) => u.customerId === customerId);
      assert.ok(update, 'expected a POST /v1/customers/:id call copying the subscription\'s own default_payment_method onto the customer');
      assert.equal(
        update.params.get('invoice_settings[default_payment_method]'),
        paymentMethodId,
        'so a later off-session invoice (the Schedule 1 charge) not tied to this subscription has a default card to use'
      );
    });

    await t.test("checkout.session.completed: Pilot's App grants mobileEnabled only, dashboardEnabled untouched", async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PILOT_APP);
      const response = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      assert.equal(tenant.mobileEnabled, true, "Pilot's App must enable mobileEnabled");
      assert.equal(tenant.dashboardEnabled, false, "Pilot's App alone must NOT enable dashboardEnabled");
    });

    await t.test('checkout.session.completed: Media Screen WITHOUT the Pack does not entitle cafe-tv, and is recorded', async () => {
      await resetBaseline(cookie, cafeTv.id); // dashboardEnabled=false -> no Pack
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_MEDIA_SCREEN);
      const response = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      const cafeTvAfter = tenant.displays.find((d) => d.slug === 'cafe-tv');
      assert.equal(cafeTvAfter.entitled, false, 'Media Screen must NOT entitle cafe-tv without the Pack');
      assert.equal(tenant.subscriptionStatus, 'active', 'payment itself still succeeded, so status still moves to active');
      const note = tenant.subscriptionHistory.find((h) => h.note.includes('does not have the Airfield Pack'));
      assert.ok(note, 'expected a subscription_history note flagging the missing Pack prerequisite');
    });

    await t.test('checkout.session.completed: Media Screen WITH the Pack entitles cafe-tv', async () => {
      await resetBaseline(cookie, cafeTv.id);
      await patchTenant(cookie, { dashboardEnabled: true }); // simulate already having the Pack
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_MEDIA_SCREEN);
      const response = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      const cafeTvAfter = tenant.displays.find((d) => d.slug === 'cafe-tv');
      assert.equal(cafeTvAfter.entitled, true, 'Media Screen must entitle cafe-tv once the tenant has the Pack');
    });

    await t.test('invoice.payment_failed: past_due, flags left exactly as they were', async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
      await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));
      const afterGrant = await getTenant(cookie);
      assert.equal(afterGrant.dashboardEnabled, true);
      assert.equal(afterGrant.mobileEnabled, true);

      const response = await postStripeEvent(invoicePaymentFailedEvent({ subscriptionId, customerId }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      assert.equal(tenant.subscriptionStatus, 'past_due');
      assert.equal(tenant.dashboardEnabled, true, 'a failed invoice must never switch a flag off');
      assert.equal(tenant.mobileEnabled, true, 'a failed invoice must never switch a flag off');
    });

    await t.test('customer.subscription.deleted: cancelling the Pack turns off dashboardEnabled AND mobileEnabled', async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
      await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));

      const response = await postStripeEvent(subscriptionDeletedEvent({ subscriptionId, customerId, priceId: STRIPE_PRICE_PACK }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      assert.equal(tenant.subscriptionStatus, 'cancelled');
      assert.equal(tenant.dashboardEnabled, false);
      assert.equal(tenant.mobileEnabled, false);
    });

    await t.test("customer.subscription.deleted: cancelling the Pilot's App turns off mobileEnabled only", async () => {
      await resetBaseline(cookie, cafeTv.id);
      await patchTenant(cookie, { dashboardEnabled: true }); // the Pack, bought separately, must survive
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PILOT_APP);
      await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId }));

      const response = await postStripeEvent(subscriptionDeletedEvent({ subscriptionId, customerId, priceId: STRIPE_PRICE_PILOT_APP }));
      assert.equal(response.status, 200);
      const tenant = await getTenant(cookie);
      assert.equal(tenant.subscriptionStatus, 'cancelled');
      assert.equal(tenant.mobileEnabled, false, "cancelling the Pilot's App must turn mobileEnabled off");
      assert.equal(tenant.dashboardEnabled, true, "cancelling the Pilot's App must NOT touch the separately-bought Pack's own flag");
    });

    await t.test('duplicate event id is ignored on redelivery (not reprocessed)', async () => {
      await resetBaseline(cookie, cafeTv.id);
      const subscriptionId = uniqueId('sub');
      const customerId = uniqueId('cus');
      registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
      const event = checkoutSessionCompletedEvent({ clientReferenceId: TEST_TENANT_ID, customerId, subscriptionId });

      const first = await postStripeEvent(event);
      assert.equal(first.status, 200);
      const afterFirst = await getTenant(cookie);
      assert.equal(afterFirst.dashboardEnabled, true);

      // Simulate something else having turned the flags back off between
      // the two deliveries - if the duplicate got reprocessed, it would
      // flip them back on; proving they STAY off is what proves the
      // duplicate was actually skipped, not just "didn't error".
      await patchTenant(cookie, { dashboardEnabled: false, mobileEnabled: false });

      const second = await postStripeEvent(event); // exact same event id+body
      assert.equal(second.status, 200);
      assert.equal(second.json.duplicate, true);
      const afterSecond = await getTenant(cookie);
      assert.equal(afterSecond.dashboardEnabled, false, 'a duplicate delivery must not be reprocessed');
      assert.equal(afterSecond.mobileEnabled, false, 'a duplicate delivery must not be reprocessed');
    });

    await t.test('every other tenant is completely untouched by the whole suite', async () => {
      const othersAfter = (await request('GET', '/api/platform/tenants', { headers: { Cookie: cookie } })).json.tenants.filter(
        (t) => t.id !== TEST_TENANT_ID
      );
      assert.deepEqual(othersAfter, othersBefore, 'no tenant other than the dedicated test tenant should have changed at all');
    });
  } finally {
    // Restore the shared test tenant to exactly its original state -
    // dashboardEnabled was true before this suite ran (migration 0106's
    // backfill), everything else was already at its baseline.
    await patchTenant(cookie, { dashboardEnabled: true, mobileEnabled: false, subscriptionStatus: 'trial' });
    await patchCafeTvDisplay(cookie, cafeTv.id, { entitled: false });
  }
});

// --- Stripe groundwork Parts B/C - paid signup, checkout, activation ---
// Each scenario below creates its own brand-new tenant via /api/public/
// signup (unique email/slug per run, via uniqueId()) rather than sharing
// TEST_TENANT_ID - no reset/cleanup race with the suite above, and
// "a freshly-signed-up tenant" is exactly the real-world case these
// endpoints exist for.

// Landing-page signup round: no lat/lon fields any more - signup.ts
// drops them entirely now (functions/api/public/signup.ts no longer
// accepts them at all), coordinates only ever come from a chosen parent.
// parentTenantId defaults to undefined (omitted), the "no parent
// chosen" case, which should succeed with null lat/lon on the created
// tenant - see the dedicated test below.
async function signUpAirfieldTenant({ plan = 'pack', termsAccepted = true, parentTenantId, mediaBoxConsent = plan === 'pack' } = {}) {
  const unique = uniqueId('signup');
  const body = {
    businessName: `Test Signup Club ${unique}`,
    contactName: 'Test Contact',
    email: `${unique}@example.com`,
    password: 'testpass123',
    slug: unique.replace(/_/g, '-').toLowerCase(),
    plan,
    termsAccepted,
    // Media Box consent round - every pre-existing call site in this
    // file signs up for 'pack' expecting success, so this defaults to
    // true for 'pack' (where signup.ts now requires it) and is simply
    // ignored by signup.ts for any other plan - no pre-existing test
    // below needed to change just because this field now exists.
    mediaBoxConsent,
    ...(parentTenantId !== undefined ? { parentTenantId } : {}),
  };
  const response = await request('POST', '/api/public/signup', { body });
  return { response, body };
}

async function signInAs(email, password) {
  const response = await request('POST', '/api/auth/sign-in/email', {
    headers: { Origin: BASE_URL },
    body: { email, password },
  });
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie, `sign-in failed for ${email}: ${JSON.stringify(response.json)}`);
  return setCookie[0].split(';')[0];
}

test('Paid signup (Part B): terms required, duplicate email rejected, no trial entitlement, real account created', async (t) => {
  await t.test('rejects without termsAccepted', async () => {
    const { response } = await signUpAirfieldTenant({ termsAccepted: false });
    assert.equal(response.status, 400);
    assert.match(response.json.error, /Terms/i);
  });

  let firstSignupBody;
  await t.test('successful signup creates a real, zero-entitlement tenant and a working login', async () => {
    const { response, body } = await signUpAirfieldTenant({ plan: 'pack' });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.ok(response.json.tenantId);
    firstSignupBody = body;

    // The new user can actually sign in - proves the account/credential
    // row was created correctly (same hashPassword format BetterAuth's
    // own verify expects), not just a tenant row.
    const cookie = await signInAs(body.email, body.password);
    const me = await request('GET', '/api/tenant/me', { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal(me.json.role, 'owner');
    assert.equal(me.json.organizationSlug, body.slug);
    // No trial - paid signup grants nothing until the webhook confirms
    // payment. cafeEntitled is the one entitlement flag /api/tenant/me
    // itself exposes; dashboardEnabled/mobileEnabled are checked via
    // the platform list endpoint below (developer-only, more direct).
    assert.equal(me.json.cafeEntitled, false);
    assert.equal(me.json.hasAcceptedTerms, true, 'termsAccepted=true at signup should already satisfy the mandatory gate');
  });

  await t.test('dashboard_enabled/mobile_enabled are both 0, not just cafe-tv', async () => {
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const created = tenants.find((tn) => tn.slug === firstSignupBody.slug);
    assert.ok(created, 'the newly-signed-up tenant should appear in the platform tenant list');
    assert.equal(created.dashboardEnabled, false);
    assert.equal(created.mobileEnabled, false);
  });

  await t.test('rejects a second signup with the same email', async () => {
    const { response: first, body } = await signUpAirfieldTenant();
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const second = await request('POST', '/api/public/signup', {
      body: { ...body, slug: `${body.slug}-again` },
    });
    assert.equal(second.status, 409);
  });
});

// --- Landing-page signup round: Parent Airfield dropdown + no-coords signup ---

test('Paid signup: Parent Airfield dropdown/validation and no-coordinates signup', async (t) => {
  await t.test('GET /api/public/parent-airfields lists only eligible parents (id + name only)', async () => {
    const response = await request('GET', '/api/public/parent-airfields');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.json.parents));
    const shobdon = response.json.parents.find((p) => p.name === 'Shobdon Airfield');
    assert.ok(shobdon, `expected Shobdon Airfield in eligible parents, got ${JSON.stringify(response.json.parents)}`);
    assert.equal(Object.keys(shobdon).sort().join(','), 'id,name', 'endpoint must return ONLY id + name, nothing else');
    assert.ok(
      !response.json.parents.some((p) => p.name === 'Your Airfield Name' || p.name === 'Demo Airfield'),
      'template/demo tenants must never appear as eligible parents'
    );
  });

  await t.test('signup with a valid parent inherits that parent\'s lat/lon, no clone', async () => {
    const parents = (await request('GET', '/api/public/parent-airfields')).json.parents;
    const shobdon = parents.find((p) => p.name === 'Shobdon Airfield');
    assert.ok(shobdon, 'Shobdon must be eligible for this test to mean anything');

    const { response, body } = await signUpAirfieldTenant({ parentTenantId: shobdon.id });
    assert.equal(response.status, 200, JSON.stringify(response.json));

    const cookie = await signInAs(body.email, body.password);
    const config = await request('GET', '/api/tenant/config', { headers: { Cookie: cookie } });
    assert.equal(config.status, 200);
    assert.ok(typeof config.json.lat === 'number' && typeof config.json.lon === 'number', 'lat/lon should be inherited from the parent, not left null');

    // parentSlug isn't exposed on /api/tenant/config's own response shape
    // (queried server-side only, for internetProviderDisplayName - see
    // that file's own comment) - parent_tenant_id itself is checked
    // directly via D1, same "shell out to wrangler d1 execute for state
    // no API exposes" pattern this file already uses for activation_links
    // below.
    const raw = execSync(
      `npx wrangler d1 execute shobdon-central --local --json --command "SELECT t.parent_tenant_id AS parentTenantId, t.lat, t.lon, p.lat AS parentLat, p.lon AS parentLon FROM tenants t JOIN tenants p ON p.id = t.parent_tenant_id WHERE t.slug = '${body.slug}'"`,
      { encoding: 'utf8' }
    );
    const row = JSON.parse(raw)[0].results[0];
    assert.equal(row.parentTenantId, shobdon.id);
    assert.equal(row.lat, row.parentLat);
    assert.equal(row.lon, row.parentLon);
  });

  await t.test('signup with an ineligible parent id (a real but non-eligible tenant) is rejected', async () => {
    // demo/newcustomer are real tenants but never eligible (template/
    // unused-as-parent) - find demo's id via the platform list the same
    // way the dashboard_enabled/mobile_enabled test above already does,
    // not hardcoded, since local/CI tenant ids can differ.
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const demo = tenants.find((tn) => tn.slug === 'demo');
    assert.ok(demo, 'expected a demo tenant to exist for this test to mean anything');

    const { response } = await signUpAirfieldTenant({ parentTenantId: demo.id });
    assert.equal(response.status, 400);
    assert.match(response.json.error, /not available/i);
  });

  await t.test('signup with a non-existent parent id is rejected', async () => {
    const { response } = await signUpAirfieldTenant({ parentTenantId: 999999999 });
    assert.equal(response.status, 400);
  });

  await t.test('signup with no parent chosen succeeds with no coordinates on file', async () => {
    const { response, body } = await signUpAirfieldTenant();
    assert.equal(response.status, 200, JSON.stringify(response.json));

    const cookie = await signInAs(body.email, body.password);
    const config = await request('GET', '/api/tenant/config', { headers: { Cookie: cookie } });
    assert.equal(config.status, 200);
    assert.equal(config.json.lat, null);
    assert.equal(config.json.lon, null);
  });
});

test('Stripe checkout endpoint (Part B/C): auth required, cannot target another tenant via activationToken', async (t) => {
  await t.test('401 when not authenticated', async () => {
    const response = await request('POST', '/api/stripe/checkout', { body: { plan: 'pack' } });
    assert.equal(response.status, 401);
  });

  await t.test('400 for an invalid plan', async () => {
    const { body } = await signUpAirfieldTenant();
    const cookie = await signInAs(body.email, body.password);
    const response = await request('POST', '/api/stripe/checkout', { headers: { Cookie: cookie }, body: { plan: 'mediaScreen' } });
    assert.equal(response.status, 400, 'mediaScreen must not be purchasable through this endpoint - see signup.ts/checkout.ts own comments');
  });

  await t.test('an activation token issued for tenant A is refused when redeemed by tenant B\'s own user', async () => {
    const tenantA = await signUpAirfieldTenant();
    const tenantB = await signUpAirfieldTenant();

    const devCookie = await login();
    const tenantsBefore = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantARow = tenantsBefore.find((tn) => tn.slug === tenantA.body.slug);
    assert.ok(tenantARow);

    const linkResponse = await request('POST', `/api/platform/tenants/${tenantARow.id}/activation-link`, {
      headers: { Cookie: devCookie },
      body: { plan: 'pack' },
    });
    assert.equal(linkResponse.status, 200, JSON.stringify(linkResponse.json));
    const token = linkResponse.json.token;

    // Validation endpoint (public) correctly reports tenant B's user as
    // NOT a member of tenant A, before any redemption is even attempted.
    const checkAsB = await request('GET', `/api/public/activation/${token}`, {
      headers: { Cookie: await signInAs(tenantB.body.email, tenantB.body.password) },
    });
    assert.equal(checkAsB.status, 200);
    assert.equal(checkAsB.json.isMemberOfTenant, false);

    // The real boundary - checkout.ts itself refuses the mismatch.
    const cookieB = await signInAs(tenantB.body.email, tenantB.body.password);
    const redeemAsB = await request('POST', '/api/stripe/checkout', {
      headers: { Cookie: cookieB },
      body: { plan: 'pack', activationToken: token },
    });
    assert.equal(redeemAsB.status, 403);

    // A failed/mismatched redemption must not consume the token - tenant
    // A's own user can still use it.
    const linkStillUnused = await request('GET', `/api/public/activation/${token}`, {
      headers: { Cookie: await signInAs(tenantA.body.email, tenantA.body.password) },
    });
    assert.equal(linkStillUnused.status, 200);
    assert.equal(linkStillUnused.json.isMemberOfTenant, true);
  });
});

test('Stripe checkout endpoint: custom_text present only when the checkout actually includes a Media Box', async (t) => {
  await t.test('Airfield Pack checkout includes the Media Box custom_text', async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pack', mediaBoxConsent: true });
    const cookie = await signInAs(body.email, body.password);
    const response = await request('POST', '/api/stripe/checkout', { headers: { Cookie: cookie }, body: { plan: 'pack' } });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const lastRequest = checkoutSessionRequests[checkoutSessionRequests.length - 1];
    assert.ok(lastRequest.get('custom_text[submit][message]'), 'Pack checkout must mention the Media Box card-charge authority');
  });

  await t.test("Pilot's App checkout (no Media Box) has no custom_text", async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pilotApp' });
    const cookie = await signInAs(body.email, body.password);
    const response = await request('POST', '/api/stripe/checkout', { headers: { Cookie: cookie }, body: { plan: 'pilotApp' } });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const lastRequest = checkoutSessionRequests[checkoutSessionRequests.length - 1];
    assert.equal(lastRequest.get('custom_text[submit][message]'), null, "Pilot's App alone must never mention the Media Box");
  });

  await t.test('an activation-link checkout follows the LINK\'s own includesMediaBox flag, not the plan', async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pilotApp' });
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);
    const cookie = await signInAs(body.email, body.password);

    const linkResponse = await request('POST', `/api/platform/tenants/${tenantRow.id}/activation-link`, {
      headers: { Cookie: devCookie },
      body: { plan: 'pilotApp', includesMediaBox: true },
    });
    assert.equal(linkResponse.status, 200, JSON.stringify(linkResponse.json));

    const response = await request('POST', '/api/stripe/checkout', {
      headers: { Cookie: cookie },
      body: { plan: 'pilotApp', activationToken: linkResponse.json.token },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const lastRequest = checkoutSessionRequests[checkoutSessionRequests.length - 1];
    assert.ok(
      lastRequest.get('custom_text[submit][message]'),
      "an activation link explicitly marked includesMediaBox:true must show the custom_text even for Pilot's App"
    );
  });
});

test('Activation links (Part C): expired and reused tokens are rejected, by both the validation endpoint and checkout.ts', async (t) => {
  const tenant = await signUpAirfieldTenant();
  const devCookie = await login();
  const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
  const tenantRow = tenants.find((tn) => tn.slug === tenant.body.slug);
  const cookie = await signInAs(tenant.body.email, tenant.body.password);

  // activation-link.ts always sets a real future (7-day) expiry, and
  // nothing exposes marking one used without actually redeeming it - a
  // direct D1 write is the only way to exercise these two paths, same
  // "shell out to wrangler d1 execute for state no API can set" pattern
  // scripts/terms-versioning.test.mjs already established.
  await t.test('expired token is rejected by both the validation endpoint and checkout.ts', async () => {
    const token = uniqueId('expired-token');
    execSync(
      `npx wrangler d1 execute shobdon-central --local --command "INSERT INTO activation_links (token, tenant_id, plan, expires_at, created_by, created_at) VALUES ('${token}', ${tenantRow.id}, 'pack', '2020-01-01T00:00:00.000Z', 'test', datetime('now'))"`,
      { cwd: process.cwd(), stdio: 'pipe' }
    );

    const check = await request('GET', `/api/public/activation/${token}`);
    assert.equal(check.status, 410);

    const redeem = await request('POST', '/api/stripe/checkout', {
      headers: { Cookie: cookie },
      body: { plan: 'pack', activationToken: token },
    });
    assert.equal(redeem.status, 410);
  });

  await t.test('already-used token is rejected by both the validation endpoint and checkout.ts', async () => {
    const token = uniqueId('used-token');
    execSync(
      `npx wrangler d1 execute shobdon-central --local --command "INSERT INTO activation_links (token, tenant_id, plan, expires_at, used_at, created_by, created_at) VALUES ('${token}', ${tenantRow.id}, 'pack', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'test', datetime('now'))"`,
      { cwd: process.cwd(), stdio: 'pipe' }
    );

    const check = await request('GET', `/api/public/activation/${token}`);
    assert.equal(check.status, 409);

    const redeem = await request('POST', '/api/stripe/checkout', {
      headers: { Cookie: cookie },
      body: { plan: 'pack', activationToken: token },
    });
    assert.equal(redeem.status, 409);
  });

  await t.test('checkout.ts rejects an unknown/garbage token cleanly', async () => {
    const response = await request('POST', '/api/stripe/checkout', {
      headers: { Cookie: cookie },
      body: { plan: 'pack', activationToken: 'not-a-real-token' },
    });
    assert.equal(response.status, 404);
  });

  assert.ok(tenantRow, 'signed-up tenant should be visible to a developer');
});

test('New-signup isolation (Part B): tenant B cannot read tenant A\'s config via ?org= override', async () => {
  const tenantA = await signUpAirfieldTenant();
  const tenantB = await signUpAirfieldTenant();
  const cookieB = await signInAs(tenantB.body.email, tenantB.body.password);

  // resolveTenantMembership's explicit-org path (tenantAuth.ts) 403s
  // for ANY org the caller isn't a member of - this is pre-existing,
  // whole-app behaviour (confirmed via investigation), exercised here
  // specifically against a tenant that only exists because of this
  // round's own new signup endpoint, to prove the new code path doesn't
  // somehow create a tenant that's reachable cross-tenant.
  const response = await request('GET', `/api/tenant/config?org=${encodeURIComponent(tenantA.body.slug)}`, {
    headers: { Cookie: cookieB },
  });
  assert.equal(response.status, 403);
});

test('Abandoned checkout: a pending signup is flagged, flips to active once the webhook lands, no existing tenant ever matches', async (t) => {
  await t.test('a brand-new paid signup reports subscriptionPending=true with the chosen plan, before any webhook arrives', async () => {
    const { response, body } = await signUpAirfieldTenant({ plan: 'pilotApp' });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const cookie = await signInAs(body.email, body.password);
    const me = await request('GET', '/api/tenant/me', { headers: { Cookie: cookie } });
    assert.equal(me.json.subscriptionPending, true);
    assert.equal(me.json.pendingPlan, 'pilotApp');
  });

  await t.test('a successful checkout.session.completed flips subscriptionPending back to false - no change needed in webhook.ts itself', async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pack' });
    const cookie = await signInAs(body.email, body.password);

    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);

    const customerId = uniqueId('cus');
    const subscriptionId = uniqueId('sub');
    registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
    const event = checkoutSessionCompletedEvent({ clientReferenceId: tenantRow.id, customerId, subscriptionId });
    const webhookResponse = await postStripeEvent(event);
    assert.equal(webhookResponse.status, 200, JSON.stringify(webhookResponse.json));

    const me = await request('GET', '/api/tenant/me', { headers: { Cookie: cookie } });
    assert.equal(me.json.subscriptionPending, false, 'webhook.ts\'s own existing setSubscriptionStatus(...active...) should already clear this');
    assert.equal(me.json.pendingPlan, null);
  });

  await t.test('an existing, pre-existing tenant (test-onboard-weather) never reports subscriptionPending=true, whatever its real subscription_status is', async () => {
    const cookie = await login();
    const me = await request('GET', '/api/tenant/me', { headers: { Cookie: cookie } });
    assert.equal(me.json.subscriptionPending, false, 'only a tenant created by functions/api/public/signup.ts can ever be pending');
  });
});

// --- Production-crash round: display-gap fix, crash-safety, dahlia payload shapes ---

test('Webhook display-gap fix: a Pack/Pilot\'s App checkout.session.completed sets tenant_displays.active=1 for main', async (t) => {
  await t.test('pack', async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pack' });
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);

    const customerId = uniqueId('cus');
    const subscriptionId = uniqueId('sub');
    registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
    const webhookResponse = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: tenantRow.id, customerId, subscriptionId }));
    assert.equal(webhookResponse.status, 200, JSON.stringify(webhookResponse.json));

    const raw = execSync(
      `npx wrangler d1 execute shobdon-central --local --json --command "SELECT active FROM tenant_displays WHERE tenant_id = ${tenantRow.id} AND slug = 'main'"`,
      { encoding: 'utf8' }
    );
    const row = JSON.parse(raw)[0].results[0];
    assert.equal(row.active, 1, 'main display must be switched active once the Pack is actually paid for - previously left at 0 forever, showing TenantUnavailable');
  });

  await t.test('pilotApp', async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pilotApp' });
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);

    const customerId = uniqueId('cus');
    const subscriptionId = uniqueId('sub');
    registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PILOT_APP);
    const webhookResponse = await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: tenantRow.id, customerId, subscriptionId }));
    assert.equal(webhookResponse.status, 200, JSON.stringify(webhookResponse.json));

    const raw = execSync(
      `npx wrangler d1 execute shobdon-central --local --json --command "SELECT active FROM tenant_displays WHERE tenant_id = ${tenantRow.id} AND slug = 'main'"`,
      { encoding: 'utf8' }
    );
    const row = JSON.parse(raw)[0].results[0];
    assert.equal(row.active, 1, 'a Pilot\'s-App-only tenant should see DashboardLockedScreen, not the generic TenantUnavailable message');
  });
});

test('Webhook crash-safety: missing secret, malformed body, and a genuine processing error', async (t) => {
  await t.test('empty/missing secret never crashes - signature check just fails closed (400), proving the fix for the production 1101 root cause', async () => {
    // Can't actually unset env.STRIPE_WEBHOOK_SECRET on the already-
    // running dev server from here, but the exact production crash
    // (crypto.subtle.importKey on a zero-length key) is reproduced
    // directly: signing with an empty-string secret produces the same
    // zero-length-key condition verifyStripeSignature's own new guard
    // exists for. The real server-side secret is still correct, so this
    // signature simply won't match either way - what matters is the
    // response is a clean 400, not a 500/thrown exception.
    const event = { id: uniqueId('evt'), type: 'checkout.session.completed', data: { object: {} } };
    const response = await postStripeEvent(event, { secret: '' });
    assert.equal(response.status, 400, JSON.stringify(response.json));
  });

  await t.test('malformed JSON body returns 400', async () => {
    const rawBody = '{not valid json';
    const signature = signEvent(rawBody);
    const response = await request('POST', '/api/stripe/webhook', { rawBody, headers: { 'stripe-signature': signature } });
    assert.equal(response.status, 400);
  });

  await t.test('a genuinely malformed-but-signed event (missing items on a subscription.deleted payload) returns JSON 500, not an uncaught crash - and the event is NOT marked duplicate, so a real Stripe retry gets a real second attempt', async () => {
    // customer.subscription.deleted normally always carries items (Stripe
    // itself guarantees this) - a payload missing it entirely exercises
    // the exact class of "unexpected shape" bug the dahlia round's own
    // production incident was, via a deterministic local repro instead of
    // a live network dependency: productForLineItems reads
    // subscription.items.data, so a subscription object with no `items`
    // key at all throws (not just returns null) deep inside the handler -
    // but only once past findTenantByStripeIds's own early-return, so
    // this must be a REAL tenant's stored subscription/customer id, not
    // an arbitrary unmatched one (which would just no-op 200, never
    // reaching the line that throws).
    const { body } = await signUpAirfieldTenant({ plan: 'pack' });
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);
    const customerId = uniqueId('cus');
    const subscriptionId = uniqueId('sub');
    registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
    await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: tenantRow.id, customerId, subscriptionId }));

    const event = {
      id: uniqueId('evt'),
      type: 'customer.subscription.deleted',
      data: { object: { id: subscriptionId, customer: customerId, status: 'canceled' } },
    };
    const first = await postStripeEvent(event);
    assert.equal(first.status, 500, JSON.stringify(first.json));
    assert.ok(first.json?.error, 'must be a JSON body Stripe can log, not an empty/HTML 1101 page');

    // Re-posting the SAME event id must NOT come back {duplicate:true} -
    // that would mean the idempotency row survived the failed attempt,
    // permanently blocking every future retry from ever truly
    // reprocessing this event.
    const second = await postStripeEvent(event);
    assert.equal(second.status, 500);
    assert.notEqual(second.json?.duplicate, true, 'a failed attempt must roll back its own stripe_events row so a retry can genuinely reprocess');
  });
});

test('Webhook dahlia-era payload shapes: invoice.paid resolves via parent.subscription_details.subscription when the old top-level field is absent', async (t) => {
  await t.test('new (dahlia) shape', async () => {
    const { body } = await signUpAirfieldTenant({ plan: 'pack' });
    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);

    const customerId = uniqueId('cus');
    const subscriptionId = uniqueId('sub');
    registerStubSubscription(subscriptionId, customerId, STRIPE_PRICE_PACK);
    await postStripeEvent(checkoutSessionCompletedEvent({ clientReferenceId: tenantRow.id, customerId, subscriptionId }));

    // Old-shape top-level `subscription` deliberately absent - only the
    // new dahlia-era nested location is present, same shape Stripe's own
    // live dashboard payload (evt_1UQrEpPd2BNJ7KAaEHVqMJgD) actually sent.
    const invoiceEvent = {
      id: uniqueId('evt'),
      type: 'invoice.paid',
      data: { object: { customer: customerId, parent: { subscription_details: { subscription: subscriptionId } } } },
    };
    const response = await postStripeEvent(invoiceEvent);
    assert.equal(response.status, 200, JSON.stringify(response.json));

    const raw = execSync(
      `npx wrangler d1 execute shobdon-central --local --json --command "SELECT note FROM subscription_history WHERE tenant_id = ${tenantRow.id} AND note = 'Stripe: invoice paid.'"`,
      { encoding: 'utf8' }
    );
    const rows = JSON.parse(raw)[0].results;
    assert.ok(rows.length >= 1, 'the dahlia-shape invoice must still resolve to this tenant and log the renewal, not silently no-op on an unmatched subscription id');
  });
});
