// Tenant-facing TV schedule round (migration 0115) - a real tenant_id
// link on pi_units, a developer-only "Linked tenant" picker on Pi
// Fleet, and new tenant-scoped routes (functions/api/tenant/tv-schedule/
// *.ts) that let a tenant's own owner/admin manage THEIR box's wake/
// sleep schedule. Same posture as every other file here: a Node built-
// in test (`node --test`), real HTTP requests against an already-
// running `wrangler pages dev`, local D1 only.
//
// Requires:
//   1. `npm run build` (dist/ must exist and be current)
//   2. `wrangler pages dev dist --port 8788` already running separately
//   3. Local D1 with migration 0115 applied (adds pi_units.tenant_id)
//      and the jeffthompson@europe.com developer user seeded.
//
// Run with: node scripts/tenant-tv-schedule.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_EMAIL = 'jeffthompson@europe.com';

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

let uniqueCounter = 0;
function uniqueId(prefix) {
  uniqueCounter += 1;
  return `${prefix}_test_${Date.now()}_${uniqueCounter}`;
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

async function signUpTenant() {
  const unique = uniqueId('ttv-signup');
  const body = {
    businessName: `Test TV Schedule Tenant ${unique}`,
    contactName: 'Test Contact',
    email: `${unique}@example.com`,
    password: 'testpass123',
    slug: unique.replace(/_/g, '-').toLowerCase(),
    plan: 'pilotApp',
    termsAccepted: true,
  };
  const response = await request('POST', '/api/public/signup', { body });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return body;
}

async function findTenantIdBySlug(devCookie, slug) {
  const response = await request('GET', '/api/platform/tenants', { headers: { Cookie: devCookie } });
  assert.equal(response.status, 200);
  const tenant = response.json.tenants.find((t) => t.slug === slug);
  assert.ok(tenant, `expected tenant with slug ${slug} to exist`);
  return tenant.id;
}

async function createLinkedBox(devCookie, tenantId) {
  const serialNumber = uniqueId('TTVBOX');
  const createResponse = await request('POST', '/api/platform/pi-units', {
    headers: { Cookie: devCookie },
    body: { serialNumber },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const boxId = createResponse.json.id;

  const linkResponse = await request('PATCH', `/api/platform/pi-units/${boxId}`, {
    headers: { Cookie: devCookie },
    body: { tenantId },
  });
  assert.equal(linkResponse.status, 200, JSON.stringify(linkResponse.json));
  assert.equal(linkResponse.json.tenantId, tenantId);

  return boxId;
}

function markBoxCheckedIn(boxId) {
  execSync(
    `npx wrangler d1 execute shobdon-central --local --command "UPDATE pi_units SET tv_schedule_last_seen_at = datetime('now') WHERE id = ${boxId}"`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );
}

function setMemberRole(email, role) {
  execSync(
    `npx wrangler d1 execute shobdon-central --local --command "UPDATE member SET role = '${role}' WHERE userId = (SELECT id FROM user WHERE email = '${email}')"`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );
}

function makeSchedule(overrides = {}) {
  const day = { wake: '07:00', sleep: '22:00', off: false };
  return {
    mon: { ...day }, tue: { ...day }, wed: { ...day }, thu: { ...day },
    fri: { ...day }, sat: { ...day }, sun: { ...day },
    ...overrides,
  };
}

test('Pi Fleet (developer): tenant linking picker', async (t) => {
  const devCookie = await login();
  const tenantA = await signUpTenant();
  const tenantAId = await findTenantIdBySlug(devCookie, tenantA.slug);

  await t.test('GET /api/platform/pi-units returns the tenants list for the picker', async () => {
    const response = await request('GET', '/api/platform/pi-units', { headers: { Cookie: devCookie } });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.json.tenants));
    assert.ok(response.json.tenants.some((t) => t.id === tenantAId));
  });

  await t.test('PATCH tenantId links a box, and the response reports linkedTenantName', async () => {
    const boxId = await createLinkedBox(devCookie, tenantAId);
    const getResponse = await request('GET', '/api/platform/pi-units', { headers: { Cookie: devCookie } });
    const box = getResponse.json.units.find((u) => u.id === boxId);
    assert.ok(box);
    assert.equal(box.tenantId, tenantAId);
    assert.equal(box.linkedTenantName, tenantA.businessName);
  });

  await t.test('PATCH tenantId: null unlinks a box', async () => {
    const boxId = await createLinkedBox(devCookie, tenantAId);
    const response = await request('PATCH', `/api/platform/pi-units/${boxId}`, {
      headers: { Cookie: devCookie },
      body: { tenantId: null },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.tenantId, null);
    assert.equal(response.json.linkedTenantName, null);
  });

  await t.test('PATCH tenantId rejects a non-existent tenant id', async () => {
    const createResponse = await request('POST', '/api/platform/pi-units', {
      headers: { Cookie: devCookie },
      body: { serialNumber: uniqueId('TTVBOX-BAD') },
    });
    const response = await request('PATCH', `/api/platform/pi-units/${createResponse.json.id}`, {
      headers: { Cookie: devCookie },
      body: { tenantId: 999999999 },
    });
    assert.equal(response.status, 400);
  });
});

test('An unlinked box is invisible to every tenant', async (t) => {
  const devCookie = await login();
  // A box exists (created via Pi Fleet) but is never linked to anyone.
  const createResponse = await request('POST', '/api/platform/pi-units', {
    headers: { Cookie: devCookie },
    body: { serialNumber: uniqueId('TTVBOX-UNLINKED') },
  });
  assert.equal(createResponse.status, 201);
  markBoxCheckedIn(createResponse.json.id);

  const tenant = await signUpTenant();
  const cookie = await signInAs(tenant.email, tenant.password);

  await t.test('the unlinked box never appears in GET /api/tenant/tv-schedule', async () => {
    const response = await request('GET', '/api/tenant/tv-schedule', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.boxes.find((b) => b.id === createResponse.json.id), undefined);
  });

  await t.test('and the sidebar flag (hasTvScheduleBox) stays false for this tenant', async () => {
    const response = await request('GET', '/api/tenant/me', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.json.hasTvScheduleBox, false);
  });
});

test('Tenant A cannot read or change tenant B\'s box', async (t) => {
  const devCookie = await login();

  const tenantA = await signUpTenant();
  const tenantB = await signUpTenant();
  const tenantBId = await findTenantIdBySlug(devCookie, tenantB.slug);
  const boxB = await createLinkedBox(devCookie, tenantBId);
  markBoxCheckedIn(boxB);

  const cookieA = await signInAs(tenantA.email, tenantA.password);

  await t.test('GET /api/tenant/tv-schedule for tenant A never lists tenant B\'s box', async () => {
    const response = await request('GET', '/api/tenant/tv-schedule', { headers: { Cookie: cookieA } });
    assert.equal(response.status, 200);
    assert.equal(response.json.boxes.find((b) => b.id === boxB), undefined);
  });

  await t.test('PATCH tenant A -> tenant B\'s box id -> 403', async () => {
    const response = await request('PATCH', `/api/tenant/tv-schedule/${boxB}`, {
      headers: { Cookie: cookieA },
      body: { enabled: true, schedule: makeSchedule() },
    });
    assert.equal(response.status, 403);
  });

  await t.test('override tenant A -> tenant B\'s box id -> 403', async () => {
    const response = await request('POST', `/api/tenant/tv-schedule/${boxB}/override`, {
      headers: { Cookie: cookieA },
      body: { action: 'wake' },
    });
    assert.equal(response.status, 403);
  });
});

test('Member role (not owner/admin) gets 403 on the tenant TV schedule routes', async (t) => {
  const devCookie = await login();
  const tenant = await signUpTenant();
  const tenantId = await findTenantIdBySlug(devCookie, tenant.slug);
  const boxId = await createLinkedBox(devCookie, tenantId);
  markBoxCheckedIn(boxId);

  // signUpTenant's own owner starts as 'owner' - downgrade to a plain
  // member role to exercise the actual 403 path, then restore (shared
  // user row, no other test depends on this specific tenant afterward).
  setMemberRole(tenant.email, 'media');
  const cookie = await signInAs(tenant.email, tenant.password);

  await t.test('GET /api/tenant/tv-schedule -> 403', async () => {
    const response = await request('GET', '/api/tenant/tv-schedule', { headers: { Cookie: cookie } });
    assert.equal(response.status, 403);
  });

  await t.test('PATCH -> 403', async () => {
    const response = await request('PATCH', `/api/tenant/tv-schedule/${boxId}`, {
      headers: { Cookie: cookie },
      body: { enabled: true, schedule: makeSchedule() },
    });
    assert.equal(response.status, 403);
  });

  await t.test('override -> 403', async () => {
    const response = await request('POST', `/api/tenant/tv-schedule/${boxId}/override`, {
      headers: { Cookie: cookie },
      body: { action: 'wake' },
    });
    assert.equal(response.status, 403);
  });
});

test('Multi-membership user acting as the wrong tenant gets 403', async (t) => {
  const devCookie = await login();

  const tenantA = await signUpTenant();
  const tenantB = await signUpTenant();
  const tenantBId = await findTenantIdBySlug(devCookie, tenantB.slug);
  const boxB = await createLinkedBox(devCookie, tenantBId);
  markBoxCheckedIn(boxB);

  // Give tenant A's own owner a SECOND membership, in tenant B's org too
  // - a real multi-membership user, not a hypothetical one. requireOwner
  // resolves "the tenant currently selected in the app" via ?org=
  // (requireTenant's own tier-1 explicit override) - same mechanism
  // every other tenant-scoped settings route in this app already uses,
  // nothing new invented for this round.
  execSync(
    `npx wrangler d1 execute shobdon-central --local --command "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES ('${uniqueId('mem')}', (SELECT organization_id FROM tenants WHERE id = ${tenantBId}), (SELECT id FROM user WHERE email = '${tenantA.email}'), 'admin', datetime('now'))"`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );
  const cookie = await signInAs(tenantA.email, tenantA.password);

  await t.test('explicitly acting as tenant A (?org=) still gets 403 on tenant B\'s own box', async () => {
    const response = await request('PATCH', `/api/tenant/tv-schedule/${boxB}?org=${tenantA.slug}`, {
      headers: { Cookie: cookie },
      body: { enabled: true, schedule: makeSchedule() },
    });
    assert.equal(response.status, 403);
  });

  await t.test('explicitly acting as tenant B (?org=) CAN reach tenant B\'s own box', async () => {
    const response = await request('GET', `/api/tenant/tv-schedule?org=${tenantB.slug}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.ok(response.json.boxes.some((b) => b.id === boxB));
  });
});

test('Tenant TV schedule: validation and override, reusing the shared logic', async (t) => {
  const devCookie = await login();
  const tenant = await signUpTenant();
  const tenantId = await findTenantIdBySlug(devCookie, tenant.slug);
  const boxId = await createLinkedBox(devCookie, tenantId);
  markBoxCheckedIn(boxId);
  const cookie = await signInAs(tenant.email, tenant.password);

  await t.test('overnight schedule rejected (same validateSchedule() as Pi Fleet)', async () => {
    const schedule = makeSchedule({ tue: { wake: '07:00', sleep: '01:00', off: false } });
    const response = await request('PATCH', `/api/tenant/tv-schedule/${boxId}`, {
      headers: { Cookie: cookie },
      body: { enabled: true, schedule },
    });
    assert.equal(response.status, 400);
    assert.match(response.json.error, /overnight/i);
  });

  let savedResponse;
  await t.test('a well-formed schedule saves and is reflected in a follow-up GET', async () => {
    savedResponse = await request('PATCH', `/api/tenant/tv-schedule/${boxId}`, {
      headers: { Cookie: cookie },
      body: { enabled: true, schedule: makeSchedule() },
    });
    assert.equal(savedResponse.status, 200, JSON.stringify(savedResponse.json));
    assert.equal(savedResponse.json.enabled, true);

    const getResponse = await request('GET', '/api/tenant/tv-schedule', { headers: { Cookie: cookie } });
    const box = getResponse.json.boxes.find((b) => b.id === boxId);
    assert.ok(box);
    assert.equal(box.enabled, true);
    assert.deepEqual(box.schedule, makeSchedule());
  });

  await t.test('Wake now sets an override that holds until the next scheduled transition, same as Pi Fleet', async () => {
    const response = await request('POST', `/api/tenant/tv-schedule/${boxId}/override`, {
      headers: { Cookie: cookie },
      body: { action: 'wake' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.overrideState, 'wake');
    assert.equal(response.json.overrideActive, true);
    assert.ok(response.json.overrideUntil);
  });

  await t.test('Clear override releases control back to the schedule', async () => {
    const response = await request('POST', `/api/tenant/tv-schedule/${boxId}/override`, {
      headers: { Cookie: cookie },
      body: { action: 'clear' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.overrideState, null);
    assert.equal(response.json.overrideActive, false);
  });

  await t.test('saving the schedule again clears any active override (same fix as Pi Fleet\'s own)', async () => {
    await request('POST', `/api/tenant/tv-schedule/${boxId}/override`, {
      headers: { Cookie: cookie },
      body: { action: 'sleep' },
    });
    const response = await request('PATCH', `/api/tenant/tv-schedule/${boxId}`, {
      headers: { Cookie: cookie },
      body: { enabled: true, schedule: makeSchedule() },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.overrideState, null);
    assert.equal(response.json.overrideActive, false);
  });

  await t.test('the tenant-facing response never includes Pi-Fleet-only fields', async () => {
    const response = await request('GET', '/api/tenant/tv-schedule', { headers: { Cookie: cookie } });
    const box = response.json.boxes.find((b) => b.id === boxId);
    const allowedKeys = ['id', 'serialNumber', 'enabled', 'schedule', 'overrideState', 'overrideUntil', 'overrideActive', 'lastSeenAt'];
    assert.deepEqual(Object.keys(box).sort(), allowedKeys.sort());
  });
});
