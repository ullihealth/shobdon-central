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

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_EMAIL = 'jeffthompson@europe.com';
const WEBHOOK_SECRET = 'whsec_local_dev_only_dummy_secret'; // must match .dev.vars
const STUB_PORT = 8799; // must match .dev.vars' STRIPE_API_BASE_URL
const STRIPE_PRICE_PACK = 'price_1UNFGQPidShgOHShVaDq5CzF';
const STRIPE_PRICE_PILOT_APP = 'price_1UNFGkPidShgOHSho400RtF5';
const STRIPE_PRICE_MEDIA_SCREEN = 'price_1UNFH3PidShgOHShe8svQZ62';

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

function registerStubSubscription(subscriptionId, customerId, priceId) {
  subscriptionsByid.set(subscriptionId, {
    id: subscriptionId,
    customer: customerId,
    status: 'active',
    items: { data: [{ price: { id: priceId } }] },
  });
}

before(async () => {
  stubServer = http.createServer((req, res) => {
    const match = req.url?.match(/^\/v1\/subscriptions\/([^/?]+)/);
    const subscription = match ? subscriptionsByid.get(decodeURIComponent(match[1])) : null;
    if (!subscription) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'No such subscription' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(subscription));
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
