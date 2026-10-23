// Post-build stamp of the released version into dist/pilot-sw.js
// (scripts/stamp-pilot-sw.mjs). The point: pilot-sw.js changes bytes ONLY when a
// new version is released, so the Pilot's App update (the "A new version of the
// app is available" box / the automatic release update) happens for releases and
// never for ordinary deploys - and a stamp problem can never
// break a build.
//
// Run with: node --test scripts/stamp-pilot-sw.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stampServiceWorkerSource, parseVersionLabel, isStampableLabel, PLACEHOLDER_LABEL } from './stamp-pilot-sw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/stamp-pilot-sw.mjs');
const realSw = fs.readFileSync(path.join(root, 'public/pilot-sw.js'), 'utf8');
const L1 = 'AIRFIELD CENTRAL V1.0.20';
const L2 = 'AIRFIELD CENTRAL V1.0.21';
const generated = (label) => `// AUTO-GENERATED\nexport const PILOT_VERSION_LABEL = ${JSON.stringify(label)}\n`;

function sandbox({ sw = realSw, version = generated(L1) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-sw-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  if (sw !== null) fs.writeFileSync(path.join(dist, 'pilot-sw.js'), sw);
  const versionFile = path.join(dir, 'pilotVersion.ts');
  if (version !== null) fs.writeFileSync(versionFile, version);
  return { dir, dist, versionFile, swPath: path.join(dist, 'pilot-sw.js') };
}
function runStamp(box) {
  return spawnSync(process.execPath, [script], { env: { ...process.env, PILOT_SW_DIST_DIR: box.dist, PILOT_VERSION_FILE: box.versionFile }, encoding: 'utf8' });
}

test('stamping: same released version -> identical bytes; new version -> different bytes', async (t) => {
  await t.test('appends one stamp line carrying the label and nothing else (no timestamp or build id)', () => {
    const out = stampServiceWorkerSource(realSw, L1);
    assert.ok(out.startsWith(realSw.replace(/\n?$/, '\n')), 'the original source is untouched');
    assert.equal(out.slice(realSw.replace(/\n?$/, '\n').length), `// pilot-release: ${L1}\n`);
  });
  await t.test('same version stamped twice (two ordinary deploys) gives byte-identical output', () => {
    assert.equal(stampServiceWorkerSource(realSw, L1), stampServiceWorkerSource(realSw, L1));
  });
  await t.test('a new released version gives different bytes (this is what triggers the banner)', () => {
    assert.notEqual(stampServiceWorkerSource(realSw, L1), stampServiceWorkerSource(realSw, L2));
  });
  await t.test('re-stamping replaces the earlier stamp instead of stacking a second one', () => {
    const once = stampServiceWorkerSource(realSw, L1);
    assert.equal(stampServiceWorkerSource(once, L1), once, 'idempotent');
    const moved = stampServiceWorkerSource(once, L2);
    assert.equal(moved, stampServiceWorkerSource(realSw, L2), 'v1 -> v2 equals stamping the clean file with v2');
    assert.equal((moved.match(/pilot-release:/g) || []).length, 1);
  });
  await t.test('works on a source with no trailing newline', () => {
    assert.equal(stampServiceWorkerSource('self.x = 1', L1), `self.x = 1\n// pilot-release: ${L1}\n`);
  });
});

test('label parsing and the placeholder guard', async (t) => {
  await t.test('reads the label out of the generated file', () => assert.equal(parseVersionLabel(generated(L1)), L1));
  await t.test('returns null for anything unreadable', () => {
    assert.equal(parseVersionLabel(''), null);
    assert.equal(parseVersionLabel('export const OTHER = 1'), null);
    assert.equal(parseVersionLabel('export const PILOT_VERSION_LABEL = ""'), null);
    assert.equal(parseVersionLabel(undefined), null);
  });
  await t.test('the V0.0.0 placeholder (D1 unreachable on a fresh clone) is not stampable; real versions are', () => {
    assert.equal(PLACEHOLDER_LABEL, 'AIRFIELD CENTRAL V0.0.0');
    assert.equal(isStampableLabel(PLACEHOLDER_LABEL), false);
    assert.equal(isStampableLabel(L1), true);
    assert.equal(isStampableLabel(''), false);
    assert.equal(isStampableLabel('bad\nlabel'), false);
  });
});

test('the build step, run as `node scripts/stamp-pilot-sw.mjs`', async (t) => {
  await t.test('stamps dist/pilot-sw.js and exits 0; running it twice leaves identical bytes', () => {
    const box = sandbox();
    const first = runStamp(box);
    assert.equal(first.status, 0);
    const afterFirst = fs.readFileSync(box.swPath, 'utf8');
    assert.ok(afterFirst.endsWith(`// pilot-release: ${L1}\n`));
    assert.equal(runStamp(box).status, 0);
    assert.equal(fs.readFileSync(box.swPath, 'utf8'), afterFirst);
  });
  await t.test('two separate builds of the same released version -> identical pilot-sw.js', () => {
    const a = sandbox(); const b = sandbox();
    runStamp(a); runStamp(b);
    assert.equal(fs.readFileSync(a.swPath, 'utf8'), fs.readFileSync(b.swPath, 'utf8'));
  });
  await t.test('a build of a NEW released version -> different pilot-sw.js', () => {
    const a = sandbox({ version: generated(L1) }); const b = sandbox({ version: generated(L2) });
    runStamp(a); runStamp(b);
    assert.notEqual(fs.readFileSync(a.swPath, 'utf8'), fs.readFileSync(b.swPath, 'utf8'));
  });
  await t.test('placeholder label (D1 unreachable): build still succeeds, file left UNSTAMPED, clear warning', () => {
    const box = sandbox({ version: generated(PLACEHOLDER_LABEL) });
    const r = runStamp(box);
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(box.swPath, 'utf8'), realSw);
    assert.match(r.stderr, /WARNING: .*could not be read at build time.*UNSTAMPED/s);
  });
  await t.test('generated version file missing: exit 0, unchanged, warning', () => {
    const box = sandbox({ version: null });
    const r = runStamp(box);
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(box.swPath, 'utf8'), realSw);
    assert.match(r.stderr, /WARNING/);
  });
  await t.test('unparseable version file: exit 0, unchanged, warning', () => {
    const box = sandbox({ version: 'garbage' });
    const r = runStamp(box);
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(box.swPath, 'utf8'), realSw);
    assert.match(r.stderr, /WARNING/);
  });
  await t.test('no dist/pilot-sw.js: exit 0 with a warning', () => {
    const r = runStamp(sandbox({ sw: null }));
    assert.equal(r.status, 0);
    assert.match(r.stderr, /WARNING.*not found/s);
  });
  await t.test('a write failure (read-only file) never fails the build', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
    const box = sandbox();
    fs.chmodSync(box.swPath, 0o444);
    const r = runStamp(box);
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(box.swPath, 'utf8'), realSw);
    assert.match(r.stderr, /WARNING: could not stamp/);
  });
});

test('wiring guards: runs in every build path, and touches none of the protected files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const build = pkg.scripts.build;
  const iGen = build.indexOf('generate-pilot-version.mjs');
  const iVite = build.indexOf('vite build');
  const iStamp = build.indexOf('stamp-pilot-sw.mjs');
  assert.ok(iGen > -1 && iVite > iGen && iStamp > iVite, `build order must be generate -> vite build -> stamp, got: ${build}`);
  assert.ok(!/\|\|/.test(build), 'no `||` in the build script: it would mask a failing vite build');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-worker.yml'), 'utf8');
  assert.match(workflow, /run: npm run build/, 'the Worker deploy workflow builds with `npm run build`, so it runs the stamp');
  assert.ok(!/run: (npx )?vite build/.test(workflow), 'the workflow must not call vite build directly (that would skip the stamp)');
  assert.ok(!fs.readFileSync(path.join(root, 'public/pilot-sw.js'), 'utf8').includes('pilot-release'), 'the SOURCE public/pilot-sw.js is never stamped - only the built copy');
});
