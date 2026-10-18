// TV wake/sleep schedule round (HDMI-CEC, migration 0114) - two kinds
// of test in this one file:
//
// 1. Pure-logic unit tests, importing functions/api/_utils/tvSchedule.mjs
//    directly (no running server, no network) - possible specifically
//    because that module is deliberately .mjs, not .ts, so plain Node
//    can import it with zero build step (see that file's own header
//    comment for why).
// 2. Integration tests against the real HTTP routes (box poll route's
//    auth, admin routes' requirePlatformAdmin gate), same
//    `wrangler pages dev`-backed posture every other file here uses.
//
// Requires for the integration half only:
//   1. `wrangler pages dev dist --port 8788` already running separately,
//      with .dev.vars' PI_FLEET_KEY set (a local-dev-only dummy value,
//      same posture as STRIPE_WEBHOOK_SECRET's own placeholder).
//   2. Local D1 with migration 0114 applied and the
//      jeffthompson@europe.com developer user seeded.
//
// Run with: node scripts/tv-schedule.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';
import {
  validateSchedule,
  computeDesiredState,
  computeNextTransition,
  londonWallTimeToUtc,
  shouldCommand,
} from '../functions/api/_utils/tvSchedule.mjs';

function makeSchedule(overrides = {}) {
  const day = { wake: '07:00', sleep: '22:00', off: false };
  return {
    mon: { ...day }, tue: { ...day }, wed: { ...day }, thu: { ...day },
    fri: { ...day }, sat: { ...day }, sun: { ...day },
    ...overrides,
  };
}

// Finds the last Sunday of a given UTC month programmatically (not
// hardcoded) - the UK's DST transition days (clocks change on the last
// Sunday of March and October) - so these tests stay correct in any
// year without needing a human to look up and hardcode the right date.
function lastSundayOfMonthUtc(year, monthIndexZeroBased) {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndexZeroBased + 1, 0));
  lastDayOfMonth.setUTCDate(lastDayOfMonth.getUTCDate() - lastDayOfMonth.getUTCDay());
  return lastDayOfMonth; // UTC midnight of that Sunday
}

test('validateSchedule', async (t) => {
  await t.test('a well-formed 7-day schedule is valid', () => {
    assert.equal(validateSchedule(makeSchedule()), null);
  });

  await t.test('an "off all day" entry does not need wake/sleep', () => {
    assert.equal(validateSchedule(makeSchedule({ sun: { off: true } })), null);
  });

  await t.test('a missing day is rejected', () => {
    const schedule = makeSchedule();
    delete schedule.sun;
    assert.match(validateSchedule(schedule), /sun/);
  });

  await t.test('a malformed time string is rejected', () => {
    const schedule = makeSchedule({ mon: { wake: '7am', sleep: '22:00', off: false } });
    assert.match(validateSchedule(schedule), /mon\.wake/);
  });

  await t.test('an overnight schedule (sleep before/equal wake) is rejected with a clear message', () => {
    const schedule = makeSchedule({ tue: { wake: '07:00', sleep: '01:00', off: false } });
    const error = validateSchedule(schedule);
    assert.match(error, /tue/);
    assert.match(error, /overnight/i);
  });

  await t.test('sleep exactly equal to wake is rejected (not a valid zero-length day)', () => {
    const schedule = makeSchedule({ wed: { wake: '09:00', sleep: '09:00', off: false } });
    assert.match(validateSchedule(schedule), /wed/);
  });
});

test('computeDesiredState: on/off at given times', async (t) => {
  const schedule = makeSchedule();

  await t.test('within wake-sleep window -> wake', () => {
    // Wed 2026-07-01 10:00 Europe/London (BST, so 09:00 UTC)
    const now = new Date('2026-07-01T09:00:00Z');
    assert.equal(computeDesiredState({ enabled: true, schedule }, now), 'wake');
  });

  await t.test('outside the window -> sleep', () => {
    // Wed 2026-07-01 23:00 Europe/London (BST, so 22:00 UTC)
    const now = new Date('2026-07-01T22:00:00Z');
    assert.equal(computeDesiredState({ enabled: true, schedule }, now), 'sleep');
  });

  await t.test('exactly at wake time -> wake (inclusive)', () => {
    const now = new Date('2026-07-01T06:00:00Z'); // 07:00 BST
    assert.equal(computeDesiredState({ enabled: true, schedule }, now), 'wake');
  });

  await t.test('exactly at sleep time -> sleep (exclusive of wake window)', () => {
    const now = new Date('2026-07-01T21:00:00Z'); // 22:00 BST
    assert.equal(computeDesiredState({ enabled: true, schedule }, now), 'sleep');
  });

  await t.test('"off all day" is always sleep, regardless of time', () => {
    const offSchedule = makeSchedule({ sun: { off: true } });
    const atNoon = new Date('2026-07-05T12:00:00Z'); // Sunday
    assert.equal(computeDesiredState({ enabled: true, schedule: offSchedule }, atNoon), 'sleep');
  });

  await t.test('disabled -> null (no command, regardless of time)', () => {
    const now = new Date('2026-07-01T09:00:00Z');
    assert.equal(computeDesiredState({ enabled: false, schedule }, now), null);
  });

  await t.test('no schedule saved -> null', () => {
    const now = new Date('2026-07-01T09:00:00Z');
    assert.equal(computeDesiredState({ enabled: true, schedule: null }, now), null);
  });
});

test('computeDesiredState: active override', async (t) => {
  const schedule = makeSchedule();

  await t.test('an active override wins over what the schedule would otherwise say', () => {
    // Schedule says 'sleep' at this time (22:00 BST), override says 'wake'.
    const now = new Date('2026-07-01T22:00:00Z');
    const overrideUntil = new Date('2026-07-01T23:00:00Z').toISOString();
    assert.equal(computeDesiredState({ enabled: true, schedule, overrideState: 'wake', overrideUntil }, now), 'wake');
  });

  await t.test('an override applies even when the weekly schedule is disabled/unset', () => {
    const now = new Date('2026-07-01T22:00:00Z');
    const overrideUntil = new Date('2026-07-01T23:00:00Z').toISOString();
    assert.equal(computeDesiredState({ enabled: false, schedule: null, overrideState: 'sleep', overrideUntil }, now), 'sleep');
  });

  await t.test('an EXPIRED override falls back to the normal schedule, not the override value', () => {
    const now = new Date('2026-07-01T09:00:00Z'); // schedule says 'wake' here
    const overrideUntil = new Date('2026-07-01T08:00:00Z').toISOString(); // already in the past
    assert.equal(computeDesiredState({ enabled: true, schedule, overrideState: 'sleep', overrideUntil }, now), 'wake');
  });
});

test('computeNextTransition', async (t) => {
  await t.test('finds a later transition on the same day', () => {
    const schedule = makeSchedule();
    const now = new Date('2026-07-01T09:00:00Z'); // 10:00 BST, next transition is 22:00 BST sleep
    const next = computeNextTransition(schedule, true, now);
    assert.equal(next.toISOString(), new Date('2026-07-01T21:00:00.000Z').toISOString());
  });

  await t.test('wraps to the next day when today has no more transitions', () => {
    const schedule = makeSchedule();
    const now = new Date('2026-07-01T23:00:00Z'); // after sleep (22:00 BST) - next is tomorrow's wake
    const next = computeNextTransition(schedule, true, now);
    assert.equal(next.toISOString(), new Date('2026-07-02T06:00:00.000Z').toISOString()); // Thu 07:00 BST
  });

  await t.test('disabled -> null', () => {
    assert.equal(computeNextTransition(makeSchedule(), false, new Date()), null);
  });

  await t.test('every day off -> null (nothing to bound an override by)', () => {
    const allOff = makeSchedule({
      mon: { off: true }, tue: { off: true }, wed: { off: true }, thu: { off: true },
      fri: { off: true }, sat: { off: true }, sun: { off: true },
    });
    assert.equal(computeNextTransition(allOff, true, new Date()), null);
  });
});

test('londonWallTimeToUtc: BST/GMT change days', async (t) => {
  const springForward = lastSundayOfMonthUtc(2026, 2); // last Sunday of March 2026
  const autumnBack = lastSundayOfMonthUtc(2026, 9); // last Sunday of October 2026

  await t.test('spring-forward: the Saturday before is still GMT (+0)', () => {
    const saturdayBefore = new Date(springForward.getTime() - 86400000);
    const y = saturdayBefore.getUTCFullYear(), m = saturdayBefore.getUTCMonth() + 1, d = saturdayBefore.getUTCDate();
    const utc = londonWallTimeToUtc(y, m, d, 9, 0); // 09:00 London
    assert.equal(utc.getUTCHours(), 9, 'GMT = UTC+0, so 09:00 London should be 09:00 UTC');
  });

  await t.test('spring-forward: the Monday after is already BST (+1)', () => {
    const mondayAfter = new Date(springForward.getTime() + 86400000);
    const y = mondayAfter.getUTCFullYear(), m = mondayAfter.getUTCMonth() + 1, d = mondayAfter.getUTCDate();
    const utc = londonWallTimeToUtc(y, m, d, 9, 0); // 09:00 London
    assert.equal(utc.getUTCHours(), 8, 'BST = UTC+1, so 09:00 London should be 08:00 UTC');
  });

  await t.test('a schedule boundary correctly flips sides of the spring-forward transition', () => {
    const schedule = makeSchedule({ sat: { wake: '09:00', sleep: '17:00', off: false }, sun: { wake: '09:00', sleep: '17:00', off: false } });
    const saturdayBefore830utc = new Date(Date.UTC(
      lastSundayOfMonthUtc(2026, 2).getUTCFullYear(), 2, lastSundayOfMonthUtc(2026, 2).getUTCDate() - 1, 8, 30
    ));
    // 08:30 UTC under GMT (+0) = 08:30 London, before the 09:00 wake time.
    assert.equal(computeDesiredState({ enabled: true, schedule }, saturdayBefore830utc), 'sleep');

    const mondayAfter830utc = new Date(Date.UTC(
      lastSundayOfMonthUtc(2026, 2).getUTCFullYear(), 2, lastSundayOfMonthUtc(2026, 2).getUTCDate() + 1, 8, 30
    ));
    // 08:30 UTC under BST (+1) = 09:30 London, now within the wake window.
    assert.equal(computeDesiredState({ enabled: true, schedule }, mondayAfter830utc), 'wake');
  });

  await t.test('autumn-back: the Saturday before is still BST (+1)', () => {
    const saturdayBefore = new Date(autumnBack.getTime() - 86400000);
    const y = saturdayBefore.getUTCFullYear(), m = saturdayBefore.getUTCMonth() + 1, d = saturdayBefore.getUTCDate();
    const utc = londonWallTimeToUtc(y, m, d, 9, 0);
    assert.equal(utc.getUTCHours(), 8, 'BST = UTC+1, so 09:00 London should still be 08:00 UTC the day before clocks go back');
  });

  await t.test('autumn-back: the Monday after is back to GMT (+0)', () => {
    const mondayAfter = new Date(autumnBack.getTime() + 86400000);
    const y = mondayAfter.getUTCFullYear(), m = mondayAfter.getUTCMonth() + 1, d = mondayAfter.getUTCDate();
    const utc = londonWallTimeToUtc(y, m, d, 9, 0);
    assert.equal(utc.getUTCHours(), 9, 'GMT = UTC+0, so 09:00 London should be 09:00 UTC again');
  });
});

test('shouldCommand: the after-boot re-assert rule', async (t) => {
  // This is the exact rule tv-schedule-check.py's own run() implements
  // against /run/airfieldcentral-tv-schedule-last-commanded.json (tmpfs,
  // cleared on every boot) - mirrored here as a small pure function so
  // it has direct unit-test coverage even though the real enforcement
  // happens in that separate Python script, not through this module.
  await t.test('no command needed when desired state matches what was last commanded (steady state)', () => {
    assert.equal(shouldCommand('wake', 'wake'), false);
  });

  await t.test('a command IS needed on a genuine state change', () => {
    assert.equal(shouldCommand('sleep', 'wake'), true);
  });

  await t.test('a command IS needed when nothing has been commanded yet this boot (tmpfs file absent/empty)', () => {
    assert.equal(shouldCommand('wake', null), true);
    assert.equal(shouldCommand('wake', undefined), true);
  });

  await t.test('no command when there is nothing to do at all (desired is null)', () => {
    assert.equal(shouldCommand(null, 'wake'), false);
  });
});

// --- Integration: the box poll route's shared-key auth ---

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

let uniqueCounter = 0;
function uniqueId(prefix) {
  uniqueCounter += 1;
  return `${prefix}_test_${Date.now()}_${uniqueCounter}`;
}

async function signUpNonDeveloperTenant() {
  const unique = uniqueId('tvsched-signup');
  const body = {
    businessName: `Test TV Schedule Club ${unique}`,
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

test('POST /api/public/pi-units/tv-schedule: shared fleet key auth', async (t) => {
  const devCookie = await login();
  // Creates its own fixture unit rather than assuming one is already
  // seeded locally - same "self-contained, re-runnable" posture every
  // other test file here already follows for its own fixtures.
  const serialNumber = uniqueId('TVSCHED');
  const createResponse = await request('POST', '/api/platform/pi-units', {
    headers: { Cookie: devCookie },
    body: { serialNumber },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const unit = createResponse.json;

  await t.test('missing key -> 401', async () => {
    const response = await request('POST', '/api/public/pi-units/tv-schedule', {
      headers: { 'X-Pi-Serial': unit.serialNumber },
    });
    assert.equal(response.status, 401);
  });

  await t.test('wrong key -> 401', async () => {
    const response = await request('POST', '/api/public/pi-units/tv-schedule', {
      headers: { 'X-Pi-Serial': unit.serialNumber, 'X-Pi-Fleet-Key': 'definitely-not-the-real-key' },
    });
    assert.equal(response.status, 401);
  });

  await t.test('missing serial -> 400', async () => {
    const key = readDevVar('PI_FLEET_KEY');
    const response = await request('POST', '/api/public/pi-units/tv-schedule', {
      headers: { 'X-Pi-Fleet-Key': key },
    });
    assert.equal(response.status, 400);
  });

  await t.test('unknown serial, correct key -> 404', async () => {
    const key = readDevVar('PI_FLEET_KEY');
    const response = await request('POST', '/api/public/pi-units/tv-schedule', {
      headers: { 'X-Pi-Serial': 'NOT-A-REAL-SERIAL', 'X-Pi-Fleet-Key': key },
    });
    assert.equal(response.status, 404);
  });

  await t.test('correct key, known serial -> 200 with the schedule shape', async () => {
    const key = readDevVar('PI_FLEET_KEY');
    const response = await request('POST', '/api/public/pi-units/tv-schedule', {
      headers: { 'X-Pi-Serial': unit.serialNumber, 'X-Pi-Fleet-Key': key },
    });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.ok('enabled' in response.json);
    assert.ok('schedule' in response.json);
    assert.ok('overrideState' in response.json);
    assert.ok('overrideUntil' in response.json);

    const after = (await request('GET', '/api/platform/pi-units', { headers: { Cookie: devCookie } })).json.units.find((u) => u.id === unit.id);
    assert.ok(after.tvScheduleLastSeenAt, 'the poll check-in should have recorded a last-seen timestamp - this table had no heartbeat at all before this round');
  });
});

function readDevVar(key) {
  try {
    const contents = execSync('cat .dev.vars', { encoding: 'utf8' });
    const match = contents.match(new RegExp(`^${key}=(.*)$`, 'm'));
    assert.ok(match, `.dev.vars is missing ${key} - add a local-dev-only dummy value, same posture as STRIPE_WEBHOOK_SECRET's own placeholder`);
    return match[1].trim();
  } catch (error) {
    throw new Error(`Could not read ${key} from .dev.vars: ${error.message}`);
  }
}

test('Platform Pi Fleet routes: requirePlatformAdmin gate', async (t) => {
  await t.test('an authenticated but non-developer user gets 403 on the TV schedule override route', async () => {
    const tenant = await signUpNonDeveloperTenant();
    const cookie = await signInAs(tenant.email, tenant.password);
    const response = await request('POST', '/api/platform/pi-units/1/tv-schedule-override', {
      headers: { Cookie: cookie },
      body: { action: 'wake' },
    });
    assert.equal(response.status, 403);
  });

  await t.test('an unauthenticated request gets 401', async () => {
    const response = await request('POST', '/api/platform/pi-units/1/tv-schedule-override', { body: { action: 'wake' } });
    assert.equal(response.status, 401);
  });
});

test('Saving the schedule or toggling Enabled clears any active override', async (t) => {
  const devCookie = await login();
  const serialNumber = uniqueId('TVSCHED-OVERRIDE-CLEAR');
  const createResponse = await request('POST', '/api/platform/pi-units', {
    headers: { Cookie: devCookie },
    body: { serialNumber },
  });
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.json));
  const unitId = createResponse.json.id;

  const schedule = makeSchedule();

  await t.test('saving the schedule clears a Wake now override set while the schedule was disabled', async () => {
    // Real-use finding, 2026-10-18 (AA0003): "Wake now" clicked while
    // disabled (no weekly schedule to bound it by) falls back to the
    // 1-hour default - confirmed below - then enabling + saving a real
    // schedule must release that override immediately, not leave the
    // TV stuck on it for up to the next hour.
    const overrideResponse = await request('POST', `/api/platform/pi-units/${unitId}/tv-schedule-override`, {
      headers: { Cookie: devCookie },
      body: { action: 'wake' },
    });
    assert.equal(overrideResponse.status, 200, JSON.stringify(overrideResponse.json));
    assert.equal(overrideResponse.json.overrideActive, true);

    const saveResponse = await request('PATCH', `/api/platform/pi-units/${unitId}`, {
      headers: { Cookie: devCookie },
      body: { tvScheduleEnabled: true, tvSchedule: schedule },
    });
    assert.equal(saveResponse.status, 200, JSON.stringify(saveResponse.json));
    assert.equal(saveResponse.json.tvScheduleOverrideActive, false, 'saving the schedule must clear the pre-existing override');
    assert.equal(saveResponse.json.tvScheduleOverrideState, null);
    assert.equal(saveResponse.json.tvScheduleOverrideUntil, null);
  });

  await t.test('toggling Enabled (with no other field change) also clears an active override', async () => {
    await request('POST', `/api/platform/pi-units/${unitId}/tv-schedule-override`, {
      headers: { Cookie: devCookie },
      body: { action: 'sleep' },
    });
    const saveResponse = await request('PATCH', `/api/platform/pi-units/${unitId}`, {
      headers: { Cookie: devCookie },
      body: { tvScheduleEnabled: false, tvSchedule: schedule },
    });
    assert.equal(saveResponse.status, 200, JSON.stringify(saveResponse.json));
    assert.equal(saveResponse.json.tvScheduleOverrideActive, false);
  });

  await t.test('an unrelated PATCH (not touching the schedule at all) must NOT clear a running override', async () => {
    await request('PATCH', `/api/platform/pi-units/${unitId}`, {
      headers: { Cookie: devCookie },
      body: { tvScheduleEnabled: true, tvSchedule: schedule },
    });
    const overrideResponse = await request('POST', `/api/platform/pi-units/${unitId}/tv-schedule-override`, {
      headers: { Cookie: devCookie },
      body: { action: 'wake' },
    });
    assert.equal(overrideResponse.status, 200, JSON.stringify(overrideResponse.json));

    const unrelatedPatch = await request('PATCH', `/api/platform/pi-units/${unitId}`, {
      headers: { Cookie: devCookie },
      body: { hostname: 'unrelated-field-change' },
    });
    assert.equal(unrelatedPatch.status, 200, JSON.stringify(unrelatedPatch.json));
    assert.equal(unrelatedPatch.json.tvScheduleOverrideActive, true, 'a PATCH that never touches tvScheduleEnabled/tvSchedule must leave an active override alone');
  });
});
