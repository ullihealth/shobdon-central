// Integration test for the terms-versioning round (migration 0108) -
// confirms RequireAuth.tsx's mandatory gate correctly re-prompts a user
// whose accepted version doesn't match TERMS_VERSION, and that accepting
// records both the timestamp and the version. Same posture as every
// other test file here: a Node built-in test (`node --test`), real HTTP
// requests against an already-running `wrangler pages dev`, local D1
// only - login is via the LOCAL-DEV-ONLY /api/dev/local-login route
// (404s in production), never a live session cookie or password.
//
// Requires:
//   1. `npm run build` (dist/ must exist and be current)
//   2. `wrangler pages dev dist --port 8788` already running separately
//   3. Local D1 seeded with the jeffthompson@europe.com developer user
//      (this repo's existing local seed data) and migration 0108 applied
//
// Run with: node scripts/terms-versioning.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_EMAIL = 'jeffthompson@europe.com';
const TEST_USER_ID = 'usr_jeff';
const CURRENT_TERMS_VERSION = '1.0'; // mirrors TERMS_VERSION, both copies

function request(method, path, { headers = {}, body } = {}) {
  const url = new URL(BASE_URL);
  const payload = body ? JSON.stringify(body) : undefined;
  const allHeaders = { ...headers };
  if (payload) {
    allHeaders['Content-Type'] = 'application/json';
    allHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    // agent: false - confirmed in an earlier round of this project's own
    // testing that a GET reusing the same keep-alive connection as an
    // immediately preceding write can see a stale pre-write snapshot
    // from wrangler's local D1 emulation. Forcing a fresh connection per
        // request sidesteps that local-dev-only artifact entirely.
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

async function getMe(cookie) {
  const response = await request('GET', '/api/tenant/me', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return response.json;
}

async function acceptTerms(cookie) {
  const response = await request('POST', '/api/tenant/terms/accept', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  return response.json;
}

// Direct DB setup/teardown for starting states the HTTP API has no way
// to produce itself (accept.ts only ever sets these forward, never
// clears them) - same "shell out to wrangler d1 execute for state this
// app's own API can't reach" pattern this project's test setup already
// uses outside test files; done here, inside, so each test is fully
// self-contained and re-runnable without manual prep.
function setUserTermsState(termsAcceptedAt, termsAcceptedVersion) {
  const atSql = termsAcceptedAt === null ? 'NULL' : `'${termsAcceptedAt}'`;
  const versionSql = termsAcceptedVersion === null ? 'NULL' : `'${termsAcceptedVersion}'`;
  execSync(
    `npx wrangler d1 execute shobdon-central --local --command "UPDATE user SET termsAcceptedAt = ${atSql}, termsAcceptedVersion = ${versionSql} WHERE id = '${TEST_USER_ID}'"`,
    { cwd: process.cwd(), stdio: 'pipe' }
  );
}

function getUserTermsStateFromDb() {
  const out = execSync(
    `npx wrangler d1 execute shobdon-central --local --command "SELECT termsAcceptedAt, termsAcceptedVersion FROM user WHERE id = '${TEST_USER_ID}'" --json`,
    { cwd: process.cwd(), stdio: 'pipe' }
  ).toString();
  const parsed = JSON.parse(out);
  return parsed[0].results[0];
}

test('terms versioning', async (t) => {
  const cookie = await login();
  // Snapshot the real starting state so this suite can restore it
  // exactly, regardless of which scenario ran last.
  const before = getUserTermsStateFromDb();

  try {
    await t.test('existing user with termsAcceptedAt but no version is re-prompted; accepting records the version and clears the prompt', async () => {
      setUserTermsState('2026-08-27 18:44:34', null); // real pre-migration-0108 shape
      const meBefore = await getMe(cookie);
      assert.equal(meBefore.hasAcceptedTerms, false, 'a user who accepted the OLD unversioned placeholder must be re-prompted');

      await acceptTerms(cookie);

      const meAfter = await getMe(cookie);
      assert.equal(meAfter.hasAcceptedTerms, true, 'accepting must clear the re-prompt');
      const dbState = getUserTermsStateFromDb();
      assert.ok(dbState.termsAcceptedAt, 'termsAcceptedAt must be set');
      assert.equal(dbState.termsAcceptedVersion, CURRENT_TERMS_VERSION, 'termsAcceptedVersion must record the current version');

      // Not prompted again on a subsequent check (same session, no further action).
      const meAgain = await getMe(cookie);
      assert.equal(meAgain.hasAcceptedTerms, true, 'must stay accepted on a later check without re-accepting');
    });

    await t.test('a new user (no termsAcceptedAt at all) is prompted; accepting sets both fields to the current version', async () => {
      setUserTermsState(null, null); // simulates a brand-new account, never accepted anything
      const meBefore = await getMe(cookie);
      assert.equal(meBefore.hasAcceptedTerms, false, 'a new user must be prompted');

      await acceptTerms(cookie);

      const dbState = getUserTermsStateFromDb();
      assert.ok(dbState.termsAcceptedAt, 'termsAcceptedAt must be set');
      assert.equal(dbState.termsAcceptedVersion, CURRENT_TERMS_VERSION);
      const meAfter = await getMe(cookie);
      assert.equal(meAfter.hasAcceptedTerms, true);
    });

    await t.test('a stale version (not just missing) also re-prompts', async () => {
      setUserTermsState('2026-10-12 09:00:00', '0.9');
      const me = await getMe(cookie);
      assert.equal(me.hasAcceptedTerms, false, 'an old version number must re-prompt exactly like a missing one');
    });
  } finally {
    // Restore the real local account to its original state, whatever
    // that was, so this suite leaves local D1 exactly as it found it.
    setUserTermsState(before.termsAcceptedAt, before.termsAcceptedVersion);
  }
});
