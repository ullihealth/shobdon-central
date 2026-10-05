// Integration test for the Reception Dashboard entitlement flag
// (migration 0106, dashboard_enabled) - Phase A4 of the Airfield Pack/
// Stripe groundwork round. Same posture as scripts/ops-panel.test.mjs
// (the only other test file in this project): a Node built-in test
// (`node --test`), run as real HTTP requests against an already-running
// `wrangler pages dev`, not a hand-mocked unit test.
//
// Uses node:http with `agent: false` instead of the global `fetch` that
// ops-panel.test.mjs uses - confirmed by hand that `wrangler pages dev`'s
// local D1 emulation serves a stale pre-write snapshot to a GET that
// reuses the same keep-alive connection as an immediately preceding
// PATCH (reproduced reliably; a fresh connection per request, or a
// brand-new process per request, never shows it). `agent: false` forces
// every request onto its own fresh connection, which sidesteps this
// local-dev-only artifact entirely rather than papering over it with a
// retry/sleep loop that would just be racing the same ambiguity.
//
// Requires:
//   1. `npm run build` (dist/ must exist and be current)
//   2. `wrangler pages dev dist --port 8788` already running separately
//   3. Local D1 seeded with the tenants this repo already ships with
//      (shobdon/demo/newcustomer/test-onboard-weather, all airfield type,
//      dashboard_enabled=1) and the jeffthompson@europe.com developer
//      user (same account ops-panel.test.mjs's login() already relies
//      on being present locally).
//
// Run with: node scripts/dashboard-entitlement.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_EMAIL = 'jeffthompson@europe.com';
// newcustomer: an existing local test-only tenant (not shobdon/demo,
// which other manual testing/screenshots rely on staying untouched) -
// used below as the one tenant this suite temporarily flips
// dashboard_enabled off on, always restored to true afterwards so the
// "every existing tenant is unaffected" guarantee holds for the NEXT
// run of this suite too, not just production.
const TEST_SUBDOMAIN = 'newcustomer.airfieldcentral.com';

function request(method, path, { headers = {}, body, host } = {}) {
  const url = new URL(BASE_URL);
  const payload = body ? JSON.stringify(body) : undefined;
  const allHeaders = { ...headers };
  // `wrangler pages dev` 308-redirects any request whose Host header
  // doesn't include the port it's actually listening on (it echoes the
  // bare host straight back, with no port added) - harmless for
  // "localhost", but for a real-looking subdomain like
  // *.airfieldcentral.com, anything that FOLLOWS that redirect
  // (curl -L, a browser, fetch's default redirect mode) resolves it via
  // real DNS and silently round-trips to production. Always passing the
  // dev server's own port here means that redirect never fires, so this
  // suite can never reach out to the internet no matter how a request
  // is made. (resolveTenantHost.ts's own `host.split(":")[0]` strips
  // the port before matching tenants.subdomain, so this changes nothing
  // about which tenant gets resolved.)
  if (host) allHeaders.Host = `${host}:${url.port}`;
  if (payload) {
    allHeaders['Content-Type'] = 'application/json';
    allHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        method,
        headers: allHeaders,
        // Confirmed by hand: a GET that reuses the same keep-alive
        // connection as an immediately preceding PATCH can see a stale
        // pre-write snapshot from `wrangler pages dev`'s local D1
        // emulation (reproduced reliably; a fresh connection, or a
        // brand-new process, never shows it). `agent: false` forces
        // every request of this suite onto its own fresh connection,
        // sidestepping that local-dev-only artifact entirely rather
        // than papering over it with a retry/sleep loop that would just
        // be racing the same ambiguity.
        agent: false,
      },
      (res) => {
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
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login() {
  const response = await request('GET', `/api/dev/local-login?email=${encodeURIComponent(TEST_EMAIL)}`);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie, 'local-login did not return a session cookie - is `wrangler pages dev` running?');
  return setCookie[0].split(';')[0];
}

async function getPublicConfig(subdomain) {
  const response = await request('GET', '/api/public/config', { host: subdomain });
  assert.equal(response.status, 200, `GET /api/public/config should succeed for an active tenant (host=${subdomain})`);
  return response.json;
}

async function getPlatformTenants(cookie) {
  const response = await request('GET', '/api/platform/tenants', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, 'GET /api/platform/tenants should succeed for a platform admin');
  return response.json;
}

async function patchTenant(cookie, tenantId, body) {
  const response = await request('PATCH', `/api/platform/tenants/${tenantId}`, { headers: { Cookie: cookie }, body });
  return { status: response.status, json: response.json };
}

test('existing tenants: dashboardEnabled is exposed on public config and defaults true, every other field untouched', async () => {
  const before = await getPublicConfig('shobdon.airfieldcentral.com');
  assert.equal(before.dashboardEnabled, true, 'shobdon was backfilled to dashboard_enabled=1 by migration 0106 - must read as true, not merely truthy-missing');
  // Spot-check a couple of fields this migration must not have touched,
  // so "zero behaviour change for existing tenants" isn't just asserted
  // about the one new field.
  assert.equal(typeof before.mobileEnabled, 'boolean');
  assert.equal(typeof before.fullBufferGateEnabled, 'boolean');
});

test('platform tenants list: dashboardEnabled is present alongside mobileEnabled for every tenant', async () => {
  const cookie = await login();
  const { tenants } = await getPlatformTenants(cookie);
  assert.ok(tenants.length > 0, 'expected at least one tenant in the local seed data');
  for (const tenant of tenants) {
    assert.equal(typeof tenant.dashboardEnabled, 'boolean', `${tenant.slug}: dashboardEnabled must be a boolean`);
    assert.equal(typeof tenant.mobileEnabled, 'boolean', `${tenant.slug}: mobileEnabled must be a boolean`);
  }
});

test('dashboard_enabled=0 is reflected on public config (drives the locked-screen gate), and mobileEnabled/Media Screen fields are unaffected', async () => {
  const cookie = await login();
  const { tenants } = await getPlatformTenants(cookie);
  const newcustomer = tenants.find((t) => t.subdomain === TEST_SUBDOMAIN);
  assert.ok(newcustomer, `expected ${TEST_SUBDOMAIN} to exist in local seed data`);
  assert.equal(newcustomer.dashboardEnabled, true, 'precondition: newcustomer should start at dashboard_enabled=1 (migration 0106 backfill)');
  const mobileBefore = newcustomer.mobileEnabled;
  const cafeTvBefore = newcustomer.displays.find((d) => d.slug === 'cafe-tv');

  try {
    // Turn the Reception Dashboard off for this one tenant.
    const off = await patchTenant(cookie, newcustomer.id, { dashboardEnabled: false });
    assert.equal(off.status, 200, `expected 200, got ${off.status}: ${JSON.stringify(off.json)}`);
    assert.equal(off.json.dashboardEnabled, false);

    const configWhileOff = await getPublicConfig(TEST_SUBDOMAIN);
    assert.equal(configWhileOff.dashboardEnabled, false, 'public config must reflect dashboard_enabled=0 - this is the exact field DashboardPage.tsx/TenantDisplayPage.tsx gate the locked screen on');

    // mobile_enabled and the café/Media Screen entitlement must be
    // completely untouched by flipping dashboard_enabled - these are
    // three independently-billed products (Pack / Pilot's App /
    // Media Screen) and must never cross-affect one another.
    const { tenants: afterList } = await getPlatformTenants(cookie);
    const afterTenant = afterList.find((t) => t.id === newcustomer.id);
    assert.equal(afterTenant.mobileEnabled, mobileBefore, 'mobileEnabled must be unaffected by toggling dashboardEnabled');
    const cafeTvAfter = afterTenant.displays.find((d) => d.slug === 'cafe-tv');
    assert.deepEqual(cafeTvAfter?.entitled, cafeTvBefore?.entitled, 'Media Screen (cafe-tv) entitlement must be unaffected by toggling dashboardEnabled');
    assert.deepEqual(cafeTvAfter?.entitlementTrialExpiresAt, cafeTvBefore?.entitlementTrialExpiresAt, 'Media Screen trial expiry must be unaffected by toggling dashboardEnabled');
  } finally {
    // Always restore, so a failed assertion above can't leave this
    // tenant - or the next run of this suite - starting from a dirty
    // state.
    const restore = await patchTenant(cookie, newcustomer.id, { dashboardEnabled: true });
    assert.equal(restore.status, 200, 'failed to restore dashboardEnabled=true during cleanup - fix local D1 by hand before re-running');
    const configAfterRestore = await getPublicConfig(TEST_SUBDOMAIN);
    assert.equal(configAfterRestore.dashboardEnabled, true);
  }
});
