// Pilot's App "Mobile Pilot View enabled" re-check (src/utils/pilotMobileGate.ts):
// false -> locked, true -> unlocked, and any failed / offline / malformed check
// leaves the state as it is. Also the 30 s throttle used for foreground checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src/utils/pilotMobileGate.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { resolveMobileEnabled, mobileCheckDue, MOBILE_CHECK_MIN_GAP_MS } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('explicit mobileEnabled:false locks an app that was live', () => {
  assert.equal(resolveMobileEnabled(true, { mobileEnabled: false, airfieldName: 'X' }), false);
});

test('explicit mobileEnabled:true unlocks a locked app (e.g. after payment)', () => {
  assert.equal(resolveMobileEnabled(false, { mobileEnabled: true }), true);
});

test('a failed or offline check (null/undefined) never changes the state', () => {
  for (const current of [true, false]) {
    assert.equal(resolveMobileEnabled(current, null), current);
    assert.equal(resolveMobileEnabled(current, undefined), current);
  }
});

test('malformed / partial config never changes the state', () => {
  for (const current of [true, false]) {
    for (const bad of [{}, { mobileEnabled: null }, { mobileEnabled: 'false' }, { mobileEnabled: 0 }, { mobileEnabled: 1 }, [], 'oops', 42, { error: 'x' }]) {
      assert.equal(resolveMobileEnabled(current, bad), current, JSON.stringify(bad));
    }
  }
});

test('foreground checks are throttled to once per 30 s; the first is always due', () => {
  assert.equal(MOBILE_CHECK_MIN_GAP_MS, 30_000);
  assert.equal(mobileCheckDue(1_000_000, null), true);
  assert.equal(mobileCheckDue(1_000_000, 1_000_000 - 29_999), false);
  assert.equal(mobileCheckDue(1_000_000, 1_000_000 - 30_000), true);
  assert.equal(mobileCheckDue(1_000_000, 1_000_000 - 120_000), true);
});

test('PilotViewPage wires the re-check to the 60 s tick and visibilitychange, and never to the update banner', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/PilotViewPage.tsx'), 'utf8');
  assert.match(page, /window\.setInterval\(\(\) => \{[^}]*checkMobileEnabled\(\)/s, 'tick calls checkMobileEnabled');
  assert.match(page, /addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(page, /mobileCheckDue\(Date\.now\(\), lastConfigReadRef\.current\)/);
  // A failed re-check must never reach the "unavailable"/locked paths.
  const fn = page.slice(page.indexOf('function checkMobileEnabled'), page.indexOf('function loadBranding'));
  assert.ok(!fn.includes('setUnavailable'), 'checkMobileEnabled must not set unavailable');
  assert.ok(!/applyUpdate|updateAvailable|location\.reload/.test(fn), 'code-update rule untouched');
});
