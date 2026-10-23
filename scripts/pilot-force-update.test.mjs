// Pilot's App forced updates (src/utils/pilotForceUpdate.ts, usePilotServiceWorker.ts,
// PilotViewPage.tsx, functions/api/platform/force-pilot-update.ts): the force
// flag handling, no reload loops, and "offline / failed never reloads".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const js = ts.transpileModule(read('src/utils/pilotForceUpdate.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { createForceWatcher, createReloadOnce, autoUpdateAllowed, runForcedUpdate, pilotForceTenantParam, AUTO_UPDATE_COOLDOWN_MS, FORCE_FALLBACK_RELOAD_MS } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function storage(initial = null) {
  let value = initial;
  return { getHandled: () => value, setHandled: (v) => { value = v; }, peek: () => value };
}

// ---------- flag handling ----------
test('the flag uses the pilot:<slug> key of the existing refresh mechanism', () => {
  assert.equal(pilotForceTenantParam('tiger-helicopters'), 'pilot:tiger-helicopters');
});

test('first read is a baseline, never a force (a stale or just-actioned flag must not reload)', () => {
  const w = createForceWatcher(storage());
  assert.equal(w.observe('2026-10-23T10:00:00.000Z'), 'baseline');
  assert.equal(w.observe('2026-10-23T10:00:00.000Z'), 'none');
  const empty = createForceWatcher(storage());
  assert.equal(empty.observe(null), 'baseline');
  assert.equal(empty.observe(null), 'none');
});

test('a later NEW timestamp forces once; the same value never forces twice', () => {
  const w = createForceWatcher(storage());
  w.observe('t1');
  assert.equal(w.observe('t2'), 'force');
  assert.equal(w.observe('t2'), 'none');
  assert.equal(w.observe('t2'), 'none');
  assert.equal(w.observe('t3'), 'force');
});

test('first read null then a first-ever force is a force', () => {
  const w = createForceWatcher(storage());
  assert.equal(w.observe(null), 'baseline');
  assert.equal(w.observe('t1'), 'force');
});

test('NO RELOAD LOOP: after a reload the request that caused it is handled (persisted) and never fires again', () => {
  const store = storage();
  const before = createForceWatcher(store);
  before.observe('t1');
  assert.equal(before.observe('t2'), 'force'); // -> reload
  assert.equal(store.peek(), 't2', 'handled value is stored BEFORE acting');
  // New page load: fresh watcher, same storage. Even if its first read were
  // delayed/odd, t2 can never trigger another reload.
  const after = createForceWatcher(store);
  assert.equal(after.observe('t2'), 'baseline');
  assert.equal(after.observe('t2'), 'none');
  const afterWithFailedFirstRead = createForceWatcher(store);
  afterWithFailedFirstRead.observe(null); // baseline taken from an empty read
  assert.equal(afterWithFailedFirstRead.observe('t2'), 'none', 'persisted handled value still blocks it');
});

test('a failed forced update can be retried once (forgive), a successful one cannot', () => {
  const store = storage();
  const w = createForceWatcher(store);
  w.observe('t1');
  assert.equal(w.observe('t2'), 'force');
  w.forgive('t2'); // offline / update() failed
  assert.equal(store.peek(), null);
  assert.equal(w.observe('t2'), 'force', 'retried on a later check');
  assert.equal(w.observe('t2'), 'none');
});

test('reload-once wrapper: many requests, one reload', () => {
  let reloads = 0;
  const once = createReloadOnce(() => { reloads += 1; });
  assert.equal(once(), true);
  assert.equal(once(), false);
  assert.equal(once(), false);
  assert.equal(reloads, 1);
});

test('auto-update after a release is limited to once per cooldown', () => {
  assert.equal(AUTO_UPDATE_COOLDOWN_MS, 10 * 60 * 1000);
  assert.equal(autoUpdateAllowed(1_000_000, null), true);
  assert.equal(autoUpdateAllowed(1_000_000, 1_000_000 - 9 * 60 * 1000), false);
  assert.equal(autoUpdateAllowed(1_000_000, 1_000_000 - 10 * 60 * 1000), true);
});

// ---------- the forced-update sequence ----------
function harness({ online = true, registration = undefined } = {}) {
  const log = { reloads: 0, activating: 0, timers: [], messages: [] };
  const reload = createReloadOnce(() => { log.reloads += 1; });
  const deps = {
    getRegistration: () => registration ?? null,
    isOnline: () => online,
    reload,
    onActivating: () => { log.activating += 1; },
    setTimer: (fn, ms) => { log.timers.push({ fn, ms }); },
  };
  return { deps, log };
}
const reg = ({ waiting = false, updateFails = false } = {}) => {
  const r = { updateCalls: 0, waiting: null, update: async () => { r.updateCalls += 1; if (updateFails) throw new Error('network'); } };
  if (waiting) r.waiting = { postMessage: (m) => r.posted.push(m) };
  r.posted = [];
  return r;
};

test('OFFLINE: nothing is reloaded or activated, result is failed', async () => {
  const registration = reg({ waiting: true });
  const { deps, log } = harness({ online: false, registration });
  assert.equal(await runForcedUpdate(deps), 'failed');
  assert.equal(log.reloads, 0);
  assert.equal(log.activating, 0);
  assert.equal(registration.updateCalls, 0);
  assert.deepEqual(registration.posted, []);
});

test('update() failing: nothing is reloaded, result is failed (app left untouched)', async () => {
  const registration = reg({ waiting: true, updateFails: true });
  const { deps, log } = harness({ registration });
  assert.equal(await runForcedUpdate(deps), 'failed');
  assert.equal(log.reloads, 0);
  assert.equal(log.activating, 0);
  assert.deepEqual(registration.posted, []);
});

test('a waiting worker is activated (SKIP_WAITING) and reload is left to controllerchange, with ONE fallback timer', async () => {
  const registration = reg({ waiting: true });
  const { deps, log } = harness({ registration });
  assert.equal(await runForcedUpdate(deps), 'reloading');
  assert.equal(registration.updateCalls, 1, 'registration.update() was called');
  assert.deepEqual(registration.posted, [{ type: 'SKIP_WAITING' }]);
  assert.equal(log.activating, 1);
  assert.equal(log.reloads, 0, 'does not reload by itself before controllerchange');
  assert.equal(log.timers.length, 1);
  assert.equal(log.timers[0].ms, FORCE_FALLBACK_RELOAD_MS);
  // controllerchange reloads, then the fallback timer firing must NOT reload again.
  deps.reload();
  log.timers[0].fn();
  assert.equal(log.reloads, 1, 'exactly one reload overall');
});

test('nothing waiting (ordinary deploy): update() then a single plain reload', async () => {
  const registration = reg({ waiting: false });
  const { deps, log } = harness({ registration });
  assert.equal(await runForcedUpdate(deps), 'reloading');
  assert.equal(registration.updateCalls, 1);
  assert.equal(log.reloads, 1);
  assert.equal(log.timers.length, 0);
});

test('no service-worker registration: plain reload when online, nothing when offline', async () => {
  const online = harness({ registration: null });
  assert.equal(await runForcedUpdate(online.deps), 'reloading');
  assert.equal(online.log.reloads, 1);
  const offline = harness({ online: false, registration: null });
  assert.equal(await runForcedUpdate(offline.deps), 'failed');
  assert.equal(offline.log.reloads, 0);
});

// ---------- wiring (source guards) ----------
test('PilotViewPage: a failed flag read changes nothing; a force runs once and un-marks on failure', () => {
  const page = read('src/pages/PilotViewPage.tsx');
  const read_ = page.slice(page.indexOf('async function readForceFlag'), page.indexOf('function checkMobileEnabled'));
  assert.match(read_, /if \(!response\.ok\) return/);
  assert.match(read_, /catch \{[\s\S]*Offline/);
  assert.ok(!/reload\(|forceUpdate\(/.test(read_), 'reading the flag never reloads directly');
  const start = page.slice(page.indexOf('async function startForcedUpdate'), page.indexOf('// Reads this tenant'));
  assert.match(start, /if \(updatingRef\.current\) return/);
  assert.match(start, /result === 'failed'[\s\S]*setUpdating\(false\)[\s\S]*forgive\(requestedAt\)/);
  // The flag is read on the 60 s tick path and on foreground (both via checkMobileEnabled) and on open/pull (loadBranding).
  assert.match(page, /checkMobileEnabled\(\)\s*checkForUpdate\(\)/);
  assert.match(page, /pilotForceTenantParam\(slug\)/);
});

test('release auto-update: a single switch, with a cooldown, falling back to the Update now box', () => {
  const policy = read('src/config/pilotUpdatePolicy.ts');
  assert.match(policy, /export const AUTO_FORCE_UPDATE_ON_RELEASE = (true|false)/);
  const page = read('src/pages/PilotViewPage.tsx');
  assert.match(page, /AUTO_FORCE_UPDATE_ON_RELEASE/);
  assert.match(page, /autoUpdateAllowed\(/);
  assert.match(page, /<PilotUpdateBanner mode="available" onUpdate=\{applyUpdate\} \/>/);
  assert.match(page, /<PilotUpdateBanner mode="updating" onUpdate=\{applyUpdate\} \/>/);
});

test('update box: large, blurred backdrop, "Update now" only in available mode, no dismiss', () => {
  const box = read('src/components/pilot/PilotUpdateBanner.tsx');
  assert.match(box, /backdrop-blur/);
  assert.match(box, /w-\[88%\]/);
  assert.match(box, /A new version of the app is available/);
  assert.match(box, /Updating to the latest version…/);
  assert.match(box, /Update now/);
  assert.ok(!/onClose|dismiss|aria-label="Close"/i.test(box.replace(/\/\/.*$/gm, '')), 'no dismiss/close path');
  assert.match(box, /mode === 'available' \?/);
});

test('force route is platform-admin only and reuses the refresh-flag Worker under pilot:<slug>', () => {
  const route = read('functions/api/platform/force-pilot-update.ts');
  assert.match(route, /requirePlatformAdmin\(request, env\)/);
  assert.match(route, /pilot:\$\{slug\}/);
  assert.match(route, /\/refresh\?key=/);
});

test('locked screen text', () => {
  const locked = read('src/components/pilot/PilotLockedScreen.tsx');
  assert.match(locked, /Pilot&apos;s App: subscription not yet active/);
  assert.match(locked, /Your airfield can activate it in a couple of minutes\. The app will return automatically once it&apos;s done\./);
  assert.ok(!locked.includes("hasn't unlocked"), 'old text is gone');
});
