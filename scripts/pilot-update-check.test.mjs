// Pilot's App: pull-to-refresh also runs the "is a new version waiting?" check.
// Pure-logic tests of src/utils/pilotUpdateCheck.ts (transpiled in memory) plus
// source guards that the wiring can't quietly start reloading or activating
// anything. The tap on the "Update available" banner must stay the ONLY way
// the Pilot's App updates.
//
// Run with: node --test scripts/pilot-update-check.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

async function load() {
  const js = ts.transpileModule(read('src/utils/pilotUpdateCheck.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

// A registration that records every call. It deliberately offers ONLY update():
// if the checker tried to reload, activate or message a worker it would throw.
function fakeRegistration(behaviour = 'ok') {
  const reg = {
    updateCalls: 0,
    update() {
      reg.updateCalls += 1;
      if (behaviour === 'reject') return Promise.reject(new TypeError('Failed to update a ServiceWorker: network error'));
      if (behaviour === 'throw') throw new Error('sync failure');
      return Promise.resolve();
    },
  };
  return reg;
}

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}

test('a pull runs the update check', async () => {
  const { createUpdateChecker } = await load();
  const reg = fakeRegistration();
  const checker = createUpdateChecker({ getRegistration: () => reg, now: clock().now });
  assert.equal(checker.check(), true);
  assert.equal(reg.updateCalls, 1);
});

test('rate-limited: at most one check every 30 seconds', async (t) => {
  const { createUpdateChecker, MIN_UPDATE_CHECK_INTERVAL_MS } = await load();
  assert.equal(MIN_UPDATE_CHECK_INTERVAL_MS, 30_000);
  const reg = fakeRegistration();
  const c = clock();
  const checker = createUpdateChecker({ getRegistration: () => reg, now: c.now });
  await t.test('repeated pulls inside the window do nothing', () => {
    assert.equal(checker.check(), true);
    c.advance(1_000);
    assert.equal(checker.check(), false);
    c.advance(10_000);
    assert.equal(checker.check(), false);
    c.advance(18_999); // 29.999s after the first check
    assert.equal(checker.check(), false);
    assert.equal(reg.updateCalls, 1, 'still just the one check');
  });
  await t.test('after 30 seconds the next pull checks again', () => {
    c.advance(1); // exactly 30s
    assert.equal(checker.check(), true);
    assert.equal(reg.updateCalls, 2);
  });
  await t.test('a pull straight after the on-open / 6-hourly check does not repeat it', () => {
    const fresh = createUpdateChecker({ getRegistration: () => reg, now: c.now });
    reg.updateCalls = 0;
    fresh.noteCheck();
    c.advance(5_000);
    assert.equal(fresh.check(), false);
    assert.equal(reg.updateCalls, 0);
    c.advance(25_000);
    assert.equal(fresh.check(), true);
  });
});

test('a failed check never breaks pull-to-refresh or surfaces an error', async (t) => {
  const { createUpdateChecker } = await load();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  await t.test('a rejected update() (offline) is swallowed', async () => {
    const reg = fakeRegistration('reject');
    const checker = createUpdateChecker({ getRegistration: () => reg, now: clock().now });
    assert.doesNotThrow(() => checker.check());
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the rejection settle
    assert.equal(reg.updateCalls, 1);
  });
  await t.test('a synchronously throwing update() is swallowed', () => {
    const reg = fakeRegistration('throw');
    const checker = createUpdateChecker({ getRegistration: () => reg, now: clock().now });
    assert.doesNotThrow(() => checker.check());
  });
  await t.test('a failed check still counts toward the rate limit (no retry storm when offline)', async () => {
    const reg = fakeRegistration('reject');
    const c = clock();
    const checker = createUpdateChecker({ getRegistration: () => reg, now: c.now });
    checker.check();
    c.advance(2_000);
    assert.equal(checker.check(), false);
    assert.equal(reg.updateCalls, 1);
  });
  await t.test('no registration yet (service workers unsupported / not registered): quietly does nothing', () => {
    const checker = createUpdateChecker({ getRegistration: () => null, now: clock().now });
    assert.equal(checker.check(), false);
    assert.equal(createUpdateChecker({ getRegistration: () => undefined }).check(), false);
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  process.off('unhandledRejection', onUnhandled);
  assert.deepEqual(unhandled, [], 'no unhandled promise rejection escaped');
});

test('it can only ever call update(): no reload, no activation, no messaging', async () => {
  const { createUpdateChecker } = await load();
  const reg = fakeRegistration();
  const checker = createUpdateChecker({ getRegistration: () => reg, now: clock().now });
  checker.check();
  assert.deepEqual(Object.keys(reg).sort(), ['update', 'updateCalls'], 'the registration was only ever touched through update()');
  const source = read('src/utils/pilotUpdateCheck.ts').replace(/\/\/.*$/gm, '');
  assert.ok(!/reload\(|skipWaiting|SKIP_WAITING|postMessage|location\./.test(source), 'the helper contains no reload/activate/message code');
});

test('wiring guards: pull-to-refresh calls the check; the tap stays the only way to update', () => {
  const page = read('src/pages/PilotViewPage.tsx');
  const hook = read('src/hooks/usePilotServiceWorker.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const handler = page.match(/function handleManualRefresh\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(handler, /checkForUpdate\(\)/, 'handleManualRefresh (the pull-to-refresh path) runs the update check');
  assert.match(handler, /loadBranding\(\)/, 'the existing data refresh is still there');
  assert.match(page, /const \{ updateAvailable, applyUpdate, checkForUpdate \} = usePilotServiceWorker\(\)/);
  assert.match(page, /\{updateAvailable && <PilotUpdateBanner onTap=\{applyUpdate\} \/>\}/, 'the banner is still driven only by updateAvailable and applyUpdate on tap');
  // Exactly one reload in the hook, still behind the tap-only guard.
  assert.equal((hook.match(/location\.reload\(\)/g) || []).length, 1, 'still exactly one reload');
  assert.match(hook, /function handleControllerChange\(\) \{\s*if \(!reloadingRef\.current\) return\s*reloadingRef\.current = false\s*window\.location\.reload\(\)/, 'the reload is still guarded by reloadingRef');
  assert.equal((hook.match(/reloadingRef\.current = true/g) || []).length, 1, 'reloadingRef is only ever set in applyUpdate');
  assert.equal((hook.match(/SKIP_WAITING/g) || []).length, 1, 'SKIP_WAITING is still sent from exactly one place (applyUpdate)');
  const checkFn = hook.match(/const checkForUpdate = useCallback\([\s\S]*?\}, \[\]\)/)?.[0] ?? '';
  assert.ok(checkFn && !/reload|SKIP_WAITING|postMessage|waitingWorker/.test(checkFn), 'checkForUpdate itself neither reloads nor activates');
});
