// Decision logic of raspberry-pi/tv-schedule-check.py (manual-override
// force-send, migration 0116). Tests the REAL Python decide_action /
// handled_override_marker (loaded via importlib, no network, no cec-ctl,
// no state files) - not a JS mirror - by replaying a sequence of polls
// through the same bookkeeping run() does with the last-commanded file.
//
// Run with: node --test scripts/tv-schedule-check.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../raspberry-pi/tv-schedule-check.py');
const hasPython = spawnSync('python3', ['--version']).status === 0;

const HARNESS = `
import importlib.util, json, sys
from datetime import datetime
spec = importlib.util.spec_from_file_location("tvcheck", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
polls = json.loads(sys.argv[2])
last = {}  # the last-commanded file; empty = just booted (tmpfs cleared)
out = []
for p in polls:
    now = datetime.fromisoformat(p["now"].replace("Z", "+00:00"))
    desired, reason = m.decide_action(p["data"], now, last)
    out.append({"desired": desired, "reason": reason})
    if desired is not None and reason is not None:  # same bookkeeping as run()
        last = {"command": desired, "overrideIssuedAt": m.handled_override_marker(p["data"], now, last)}
print(json.dumps(out))
`;

function replay(polls) {
  return JSON.parse(execFileSync('python3', ['-I', '-c', HARNESS, SCRIPT, JSON.stringify(polls)], { encoding: 'utf8' }));
}

const day = { wake: '07:00', sleep: '22:00', off: false };
const schedule = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [k, day]));
// 2026-10-19 is a Monday; BST ended 25 Oct, so London = UTC+1 here.
const poll = (now, extra = {}) => ({
  now,
  data: { enabled: true, schedule, overrideState: null, overrideUntil: null, overrideIssuedAt: null, ...extra },
});
const override = (state, issuedAt, until = '2026-10-19T21:00:00Z') => ({ overrideState: state, overrideUntil: until, overrideIssuedAt: issuedAt });

const T = { noon: '2026-10-19T11:00:00Z', n1: '2026-10-19T11:01:00Z', n2: '2026-10-19T11:02:00Z', n3: '2026-10-19T11:03:00Z' };
const reasons = (r) => r.map((x) => x.reason);

test('tv-schedule-check decision logic', { skip: !hasPython && 'python3 not available' }, async (t) => {
  await t.test('baseline: first run after boot sends once, then steady state sends nothing', () => {
    assert.deepEqual(reasons(replay([poll(T.noon), poll(T.n1), poll(T.n2)])), ['state change', null, null]);
  });

  await t.test('new override while the box already believes the TV is in that state -> sends', () => {
    const r = replay([poll(T.noon), poll(T.n1, override('wake', '2026-10-19T11:01:00.000Z'))]);
    assert.deepEqual(r[1], { desired: 'wake', reason: 'manual override (new)' });
  });

  await t.test('the same override seen on later polls -> no resend', () => {
    const o = override('wake', '2026-10-19T11:01:00.000Z');
    assert.deepEqual(reasons(replay([poll(T.noon), poll(T.n1, o), poll(T.n2, o), poll(T.n3, o)])), ['state change', 'manual override (new)', null, null]);
  });

  await t.test('second press of the same button (same override_until, new issued-at) -> sends again', () => {
    const first = override('wake', '2026-10-19T11:01:00.000Z');
    const second = override('wake', '2026-10-19T11:03:00.000Z');
    assert.deepEqual(reasons(replay([poll(T.noon), poll(T.n1, first), poll(T.n2, first), poll(T.n3, second)])), ['state change', 'manual override (new)', null, 'manual override (new)']);
  });

  await t.test('override to the opposite state sends the matching command', () => {
    const r = replay([poll(T.noon), poll(T.n1, override('sleep', '2026-10-19T11:01:00.000Z'))]);
    assert.deepEqual(r[1], { desired: 'sleep', reason: 'manual override (new)' });
  });

  await t.test('scheduled transitions are unchanged: edge-triggered, no resend each minute', () => {
    // Mon 21:59 UTC = 22:59 London (past sleep 22:00) vs 20:59 UTC = 21:59 London (awake).
    const r = replay([poll('2026-10-19T20:59:00Z'), poll('2026-10-19T21:00:00Z'), poll('2026-10-19T21:01:00Z'), poll('2026-10-19T21:02:00Z')]);
    assert.deepEqual(r.map((x) => x.desired), ['wake', 'sleep', 'sleep', 'sleep']);
    assert.deepEqual(reasons(r), ['state change', 'state change', null, null]);
  });

  await t.test('override expiry back to the same state as the schedule -> no extra send', () => {
    const o = override('wake', '2026-10-19T11:01:00.000Z', '2026-10-19T11:03:00Z');
    // After expiry the server returns the override fields as null; schedule says wake.
    assert.deepEqual(reasons(replay([poll(T.noon), poll(T.n1, o), poll(T.n2, o), poll('2026-10-19T11:04:00Z')])), ['state change', 'manual override (new)', null, null]);
  });

  await t.test('override expiry to a different state -> one normal state-change send (not a manual one)', () => {
    const o = override('sleep', '2026-10-19T11:01:00.000Z', '2026-10-19T11:03:00Z');
    const r = replay([poll(T.noon), poll(T.n1, o), poll('2026-10-19T11:04:00Z')]);
    assert.deepEqual(reasons(r), ['state change', 'manual override (new)', 'state change']);
    assert.equal(r[2].desired, 'wake');
  });

  await t.test('an expired press is not re-sent if the same marker lingers in a stale cached poll', () => {
    const o = override('wake', '2026-10-19T11:01:00.000Z', '2026-10-19T11:03:00Z');
    assert.deepEqual(reasons(replay([poll(T.noon), poll(T.n1, o), poll('2026-10-19T11:05:00Z', o)])), ['state change', 'manual override (new)', null]);
  });

  await t.test('older server (no overrideIssuedAt) keeps the old edge-triggered behaviour', () => {
    const legacy = { overrideState: 'wake', overrideUntil: '2026-10-19T21:00:00Z' };
    assert.deepEqual(reasons(replay([poll(T.noon), poll(T.n1, legacy), poll(T.n2, legacy)])), ['state change', null, null]);
  });

  await t.test('override works when the weekly schedule is disabled; nothing sent with no override and no schedule', () => {
    const off = (now, extra = {}) => ({ now, data: { enabled: false, schedule: null, overrideState: null, overrideUntil: null, ...extra } });
    const r = replay([off(T.noon), off(T.n1, override('wake', 'A')), off(T.n2, override('wake', 'A'))]);
    assert.deepEqual(reasons(r), [null, 'manual override (new)', null]);
  });
});
