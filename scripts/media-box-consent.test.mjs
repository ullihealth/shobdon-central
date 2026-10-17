// Integration test for the Media Box loan consent round (migration
// 0113) - a SEPARATE, explicit consent to Customer Terms Schedule 1
// (the Media Box loan + up-to-£99-per-incident card-charge authority),
// distinct from general Customer Terms acceptance (scripts/
// terms-versioning.test.mjs's own user.termsAccepted* coverage). Same
// posture as every other test file here: a Node built-in test
// (`node --test`), real HTTP requests against an already-running
// `wrangler pages dev`, local D1 only.
//
// Requires:
//   1. `npm run build` (dist/ must exist and be current)
//   2. `wrangler pages dev dist --port 8788` already running separately
//   3. Local D1 with migration 0113 applied, and the
//      jeffthompson@europe.com developer user seeded (this repo's
//      existing local seed data)
//
// Run with: node scripts/media-box-consent.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_EMAIL = 'jeffthompson@europe.com';
const CURRENT_TERMS_VERSION = '1.0'; // mirrors TERMS_VERSION, same as terms-versioning.test.mjs's own copy

function request(method, path, { headers = {}, body } = {}) {
  const url = new URL(BASE_URL);
  const payload = body ? JSON.stringify(body) : undefined;
  const allHeaders = { ...headers };
  if (payload) {
    allHeaders['Content-Type'] = 'application/json';
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

let counter = 0;
function uniqueId(prefix) {
  counter += 1;
  return `${prefix}_test_${Date.now()}_${counter}`;
}

async function login() {
  const response = await request('GET', `/api/dev/local-login?email=${encodeURIComponent(TEST_EMAIL)}`);
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie, 'local-login did not return a session cookie - is `wrangler pages dev` running?');
  return setCookie[0].split(';')[0];
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

// Same shape functions/api/public/signup.ts expects - mirrors
// scripts/stripe-webhook.test.mjs's own signUpAirfieldTenant helper,
// duplicated rather than imported (each test file here is
// self-contained - see e.g. terms-versioning.test.mjs's own duplicated
// request()/login()).
async function signUpAirfieldTenant({ plan = 'pack', termsAccepted = true, mediaBoxConsent } = {}) {
  const unique = uniqueId('mbc-signup');
  const body = {
    businessName: `Test Media Box Club ${unique}`,
    contactName: 'Test Contact',
    email: `${unique}@example.com`,
    password: 'testpass123',
    slug: unique.replace(/_/g, '-').toLowerCase(),
    plan,
    termsAccepted,
    ...(mediaBoxConsent !== undefined ? { mediaBoxConsent } : {}),
  };
  const response = await request('POST', '/api/public/signup', { body });
  return { response, body };
}

function getTenantMediaBoxStateFromDb(tenantId) {
  const raw = execSync(
    `npx wrangler d1 execute shobdon-central --local --json --command "SELECT media_box_consent_at AS consentAt, media_box_consent_version AS consentVersion, media_box_consent_ip AS consentIp FROM tenants WHERE id = ${tenantId}"`,
    { encoding: 'utf8' }
  );
  return JSON.parse(raw)[0].results[0];
}

test('Media Box consent (paid signup): required only when the plan includes a Media Box', async (t) => {
  await t.test('Airfield Pack signup without mediaBoxConsent is rejected', async () => {
    const { response } = await signUpAirfieldTenant({ plan: 'pack' });
    assert.equal(response.status, 400);
    assert.match(response.json.error, /Media Box/i);
  });

  await t.test('Airfield Pack signup with mediaBoxConsent:true succeeds and records version + timestamp against the tenant', async () => {
    const { response, body } = await signUpAirfieldTenant({ plan: 'pack', mediaBoxConsent: true });
    assert.equal(response.status, 200, JSON.stringify(response.json));

    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow, 'the newly-signed-up tenant should appear in the platform tenant list');
    assert.ok(tenantRow.mediaBoxConsentAt, 'GET /api/platform/tenants should report a given-date, not "not given"');

    const dbState = getTenantMediaBoxStateFromDb(tenantRow.id);
    assert.ok(dbState.consentAt, 'media_box_consent_at must be set');
    assert.equal(dbState.consentVersion, CURRENT_TERMS_VERSION, 'media_box_consent_version must record the current Terms version');
    // IP is whatever CF-Connecting-IP resolves to locally (often empty,
    // since this plain Node HTTP client sends no such header) - the
    // point of this assertion is that the column was actually WRITTEN
    // (a string, not left NULL), not that it holds a real address.
    assert.equal(typeof dbState.consentIp, 'string', 'media_box_consent_ip must be recorded (even if empty locally)');
  });

  await t.test("Pilot's App signup with no mediaBoxConsent at all succeeds - no box, nothing to consent to", async () => {
    const { response, body } = await signUpAirfieldTenant({ plan: 'pilotApp' });
    assert.equal(response.status, 200, JSON.stringify(response.json));

    const devCookie = await login();
    const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
    const tenantRow = tenants.find((tn) => tn.slug === body.slug);
    assert.ok(tenantRow);
    assert.equal(tenantRow.mediaBoxConsentAt, null, "a Pilot's-App-only tenant should never get a Media Box consent timestamp");
  });
});

test('Media Box consent (activation link, Part C): per-link flag, separate acceptance endpoint, recorded on the tenant', async (t) => {
  const devCookie = await login();

  // An existing tenant reached via an activation link, same shape as
  // scripts/stripe-webhook.test.mjs's own activation-link tests -
  // Pilot's App plan so the general Terms checkbox path is exercised
  // independently of the Media Box one.
  const { body } = await signUpAirfieldTenant({ plan: 'pilotApp' });
  const tenants = (await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } })).json.tenants;
  const tenantRow = tenants.find((tn) => tn.slug === body.slug);
  assert.ok(tenantRow);
  const cookie = await signInAs(body.email, body.password);

  await t.test('a link created with includesMediaBox:true requires the dedicated consent endpoint before it is granted', async () => {
    const linkResponse = await request('POST', `/api/platform/tenants/${tenantRow.id}/activation-link`, {
      headers: { Cookie: devCookie },
      body: { plan: 'pilotApp', includesMediaBox: true },
    });
    assert.equal(linkResponse.status, 200, JSON.stringify(linkResponse.json));
    const token = linkResponse.json.token;

    const beforeTerms = await request('GET', `/api/public/activation/${token}`, { headers: { Cookie: cookie } });
    assert.equal(beforeTerms.status, 200);
    assert.equal(beforeTerms.json.includesMediaBox, true);
    assert.equal(beforeTerms.json.hasMediaBoxConsent, false);

    // General Terms acceptance first - the Media Box checkbox is a
    // SEPARATE, additional step on top of it, not a substitute.
    const acceptTerms = await request('POST', '/api/tenant/terms/accept', { headers: { Cookie: cookie } });
    assert.equal(acceptTerms.status, 200);

    const afterTerms = await request('GET', `/api/public/activation/${token}`, { headers: { Cookie: cookie } });
    assert.equal(afterTerms.json.hasAcceptedCurrentTerms, true);
    assert.equal(afterTerms.json.hasMediaBoxConsent, false, 'accepting the general Terms must NOT also satisfy the separate Media Box consent');

    const acceptMediaBox = await request('POST', '/api/tenant/media-box-consent/accept', { headers: { Cookie: cookie } });
    assert.equal(acceptMediaBox.status, 200, JSON.stringify(acceptMediaBox.json));

    const afterMediaBox = await request('GET', `/api/public/activation/${token}`, { headers: { Cookie: cookie } });
    assert.equal(afterMediaBox.json.hasMediaBoxConsent, true);

    const dbState = getTenantMediaBoxStateFromDb(tenantRow.id);
    assert.ok(dbState.consentAt);
    assert.equal(dbState.consentVersion, CURRENT_TERMS_VERSION);
  });

  await t.test('a link created with includesMediaBox:false never requires it', async () => {
    const linkResponse = await request('POST', `/api/platform/tenants/${tenantRow.id}/activation-link`, {
      headers: { Cookie: devCookie },
      body: { plan: 'pilotApp', includesMediaBox: false },
    });
    assert.equal(linkResponse.status, 200, JSON.stringify(linkResponse.json));
    const check = await request('GET', `/api/public/activation/${linkResponse.json.token}`, { headers: { Cookie: cookie } });
    assert.equal(check.json.includesMediaBox, false);
  });

  await t.test('an activation link created with no includesMediaBox field at all defaults to true', async () => {
    const linkResponse = await request('POST', `/api/platform/tenants/${tenantRow.id}/activation-link`, {
      headers: { Cookie: devCookie },
      body: { plan: 'pilotApp' },
    });
    assert.equal(linkResponse.status, 200, JSON.stringify(linkResponse.json));
    const check = await request('GET', `/api/public/activation/${linkResponse.json.token}`, { headers: { Cookie: cookie } });
    assert.equal(check.json.includesMediaBox, true, 'omitted includesMediaBox must default ON');
  });
});
