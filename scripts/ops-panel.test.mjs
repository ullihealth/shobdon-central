// Integration test for functions/api/tenant/ops-panel/index.ts's PUT -
// specifically the over-length safety-notice self-heal round (see that
// file's own ensureNoticeShape/neededHealing comments for the full
// story: migrations 0026/0031 seeded a 41-char notice, one character
// over SAFETY_NOTICE_MAX_LENGTH, which used to 400 every Update
// Dashboard on any tenant cloned from that template).
//
// No test framework existed anywhere in this project before this file
// (no vitest/jest dependency, no "test" script, no other *.test.ts) -
// added via Node's own built-in test runner (stable since Node 18,
// zero new dependencies) rather than introducing a framework unprompted
// for one test file. Deliberately an INTEGRATION test, not a unit test
// in isolation - this project's own established way of verifying a
// Pages Function route (used throughout this investigation) is real
// HTTP requests against `wrangler pages dev`, so this follows the same
// pattern instead of hand-mocking D1/Request/Env, which Cloudflare
// Pages Functions aren't built to make easy anyway.
//
// Requires:
//   1. `npm run build` (dist/ must exist and be current)
//   2. `wrangler pages dev dist --port 8788` already running separately
//      (same two-step flow this project's own CLAUDE.md verification
//      guidance already describes for backend changes - not something
//      this script starts/stops itself, so a human/CI step controls
//      that lifecycle explicitly rather than this script silently
//      spawning and leaking a background server).
//   3. Local D1 has the `jeffthompson@europe.com` user as owner of
//      org_demo (true of this repo's existing local seed data), with an
//      existing ops_panel_state row for it (also true out of the box -
//      every tenant does by migration 0022's own default-row insert).
//
// Run with: node scripts/ops-panel.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.OPS_PANEL_TEST_BASE_URL ?? 'http://localhost:8788';
const TEST_ORG_SLUG = 'demo';
const TEST_EMAIL = 'jeffthompson@europe.com';

async function login() {
  const response = await fetch(`${BASE_URL}/api/dev/local-login?email=${encodeURIComponent(TEST_EMAIL)}`, {
    redirect: 'manual',
  });
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'local-login did not return a session cookie - is `wrangler pages dev` running with WRANGLER_PAGES_DEV_LOCAL_ONLY set (the default for `wrangler pages dev`)?');
  return setCookie.split(';')[0];
}

async function getOpsPanel(cookie) {
  const response = await fetch(`${BASE_URL}/api/tenant/ops-panel?org=${TEST_ORG_SLUG}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200, 'GET /api/tenant/ops-panel should always succeed for an existing row');
  return response.json();
}

async function putOpsPanel(cookie, body) {
  const response = await fetch(`${BASE_URL}/api/tenant/ops-panel?org=${TEST_ORG_SLUG}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

function fullBodyFrom(opsPanel, overrides) {
  // Mirrors AtcControlPage.tsx's own handleUpdateDashboard exactly -
  // spread the last-loaded full row, then override. The PUT requires
  // every field in one shot (full-replace, 292547d), so a test body
  // that's missing fields this suite doesn't care about would itself
  // 400 for the wrong reason.
  return {
    activeRunwayEnd: opsPanel.activeRunwayEnd || '08',
    circuitDirection: opsPanel.circuitDirection,
    airfieldInfoText: opsPanel.airfieldInfoText,
    showAutoNotams: opsPanel.showAutoNotams,
    notamsCarouselIntervalSeconds: opsPanel.notamsCarouselIntervalSeconds,
    notamsOpsDurationSeconds: opsPanel.notamsOpsDurationSeconds,
    notamsFullDurationSeconds: opsPanel.notamsFullDurationSeconds,
    noticesDurationSeconds: opsPanel.noticesDurationSeconds,
    weatherSummaryChartEnabled: opsPanel.weatherSummaryChartEnabled,
    weatherSummaryStateADurationSeconds: opsPanel.weatherSummaryStateADurationSeconds,
    weatherSummaryStateBDurationSeconds: opsPanel.weatherSummaryStateBDurationSeconds,
    runwaysClosed: opsPanel.runwaysClosed,
    runwayAutomationEnabled: opsPanel.runwayAutomationEnabled,
    ...overrides,
  };
}

test('ops-panel PUT: a 41-char notice is accepted and saved truncated to 40', async () => {
  const overLength = 'Grass runway - check NOTAMs for condition'; // 41 chars
  assert.equal(overLength.length, 41, 'fixture sanity check - this string must itself be 41 chars for the test to mean anything');

  const cookie = await login();
  const before = await getOpsPanel(cookie);

  // Submit the over-length notice directly through the PUT itself - this
  // is what actually changed (the 400-on-reject -> truncate-and-accept
  // behaviour), and it covers the real-world case either way a tenant
  // ends up with one: a brand-new submission that happens to be long, or
  // - what actually happened in production - a pre-existing stale value
  // getting round-tripped unchanged by AtcControlPage.tsx's full-replace
  // save (292547d). The GET-side self-heal (neededHealing persisting the
  // truncated value back for an already-stored stale row) was verified
  // by hand against the real stale production data during this
  // investigation, not re-asserted here, since reproducing THAT exact
  // precondition would mean reaching outside this script's own process
  // to seed D1 directly - this test instead proves the PUT handles an
  // over-length value correctly regardless of where it came from, which
  // is the actual code path both cases share.
  const { status, json } = await putOpsPanel(cookie, fullBodyFrom(before, { safetyNotices: [{ text: overLength, size: 'md', enabled: true }] }));
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(json.ok, true);

  const after = await getOpsPanel(cookie);
  const saved = after.safetyNotices.find((n) => n.text.startsWith('Grass runway'));
  assert.ok(saved, 'the submitted notice should be present in the saved result');
  assert.equal(saved.text, overLength.slice(0, 40).trimEnd());
  assert.ok(saved.text.length <= 40);
});

test('ops-panel PUT: malformed notices payload is still rejected with 400', async () => {
  const cookie = await login();
  const before = await getOpsPanel(cookie);

  // size is not one of 'sm'|'md'|'lg'|'xl' - genuinely malformed, must
  // still reject (not a length issue, so self-healing must not apply).
  const badSize = await putOpsPanel(cookie, fullBodyFrom(before, { safetyNotices: [{ text: 'ok', size: 'huge', enabled: true }] }));
  assert.equal(badSize.status, 400);

  // text is not a string at all.
  const badType = await putOpsPanel(cookie, fullBodyFrom(before, { safetyNotices: [{ text: 42, size: 'md', enabled: true }] }));
  assert.equal(badType.status, 400);

  // safetyNotices itself is not an array.
  const notArray = await putOpsPanel(cookie, fullBodyFrom(before, { safetyNotices: 'nope' }));
  assert.equal(notArray.status, 400);

  // Too many rows (> SAFETY_NOTICE_MAX_ROWS) - still a hard reject per
  // the task's own instruction, not something to silently truncate.
  const tooMany = await putOpsPanel(
    cookie,
    fullBodyFrom(before, { safetyNotices: Array.from({ length: 11 }, (_, i) => ({ text: `n${i}`, size: 'md', enabled: true })) })
  );
  assert.equal(tooMany.status, 400);
});
