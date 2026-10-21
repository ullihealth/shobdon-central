// Runway strip count rules (1 / 2 / 3 parallel strips). Pure-logic tests, no
// server needed:
//   - functions/api/_utils/runwayStrips.mjs  (server: count rule + validation)
//   - src/utils/runwayStrips.ts              (client: count rule + the
//     1 -> 2 -> 3 mapping the Runways page uses). TypeScript, so it is
//     transpiled in-memory with the repo's own `typescript` package.
// Plus one source-level guard that tenant/config.ts validates BEFORE its
// destructive delete-and-reinsert of runway_groups.
//
// Run with: node --test scripts/runway-strips.test.mjs (or npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { runwayStripCount as serverCount, validateRunwayGroups } from '../functions/api/_utils/runwayStrips.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadClientHelpers() {
  const source = fs.readFileSync(path.join(root, 'src/utils/runwayStrips.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

const strip = (colour = '#a8b4c4') => ({ colour, widthPx: 22, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true });
const group = (twin, n) => ({ id: 'g', endAIdentifier: '09', endBIdentifier: '27', headingDegrees: 90, twin, stripLengthPx: 216, identifierFontSizePx: 14, strips: Array.from({ length: n }, () => strip()) });

test('strip count: existing data resolves exactly as it always did', async (t) => {
  const client = await loadClientHelpers();
  for (const [name, count] of [['client', client.runwayStripCount], ['server', serverCount]]) {
    await t.test(`${name}: twin off with 1 strip = 1`, () => assert.equal(count(group(false, 1)), 1));
    await t.test(`${name}: twin on with 2 strips = 2`, () => assert.equal(count(group(true, 2)), 2));
    await t.test(`${name}: twin on with 3 strips = 3`, () => assert.equal(count(group(true, 3)), 3));
    await t.test(`${name}: a legacy row (twin off, 2 strips) still reads as 1 - unchanged from today`, () => assert.equal(count(group(false, 2)), 1));
    await t.test(`${name}: a legacy row (twin on, 1 strip) still reads as 2 - unchanged from today`, () => assert.equal(count(group(true, 1)), 2));
  }
});

test('Runways page mapping: choosing 1 / 2 / 3 strips', async (t) => {
  const { withStripCount, runwayStripCount, defaultStripFor } = await loadClientHelpers();

  await t.test('1 -> 2 keeps strip 1, adds a default strip 2, sets twin', () => {
    const start = group(false, 1);
    start.strips[0].colour = '#123456';
    const next = withStripCount(start, 2);
    assert.equal(next.twin, true);
    assert.equal(next.strips.length, 2);
    assert.equal(next.strips[0].colour, '#123456');
    assert.deepEqual(next.strips[1], defaultStripFor(1, 2));
    assert.equal(runwayStripCount({ ...start, ...next }), 2);
  });

  await t.test('2 -> 3 keeps both strips, adds a third, twin stays true', () => {
    const start = group(true, 2);
    start.strips[0].colour = '#111111';
    start.strips[1].colour = '#222222';
    const next = withStripCount(start, 3);
    assert.equal(next.twin, true);
    assert.deepEqual(next.strips.map((s) => s.colour).slice(0, 2), ['#111111', '#222222']);
    assert.equal(next.strips.length, 3);
    assert.equal(runwayStripCount({ ...start, ...next }), 3);
  });

  await t.test('3 -> 2 -> 1 drops the last strips and keeps the first ones', () => {
    const start = group(true, 3);
    start.strips.forEach((s, i) => (s.colour = `#00000${i + 1}`));
    const two = withStripCount(start, 2);
    assert.deepEqual(two.strips.map((s) => s.colour), ['#000001', '#000002']);
    assert.equal(two.twin, true);
    const one = withStripCount({ strips: two.strips }, 1);
    assert.deepEqual(one.strips.map((s) => s.colour), ['#000001']);
    assert.equal(one.twin, false);
  });

  await t.test('1 -> 3 in one step fills two new strips', () => {
    const next = withStripCount(group(false, 1), 3);
    assert.equal(next.strips.length, 3);
    assert.equal(next.twin, true);
  });

  await t.test('defaults for 1 and 2 strips are exactly what the old Twin checkbox created', () => {
    assert.equal(defaultStripFor(0, 1).colour, '#a8b4c4');
    assert.equal(defaultStripFor(0, 2).colour, '#4caf50');
    assert.equal(defaultStripFor(1, 2).colour, '#a8b4c4');
  });
});

test('server validation: accepts 1-3 strips, rejects everything else', async (t) => {
  await t.test('accepts 1, 2 and 3 strips', () => {
    assert.equal(validateRunwayGroups([group(false, 1)]), null);
    assert.equal(validateRunwayGroups([group(true, 2)]), null);
    assert.equal(validateRunwayGroups([group(true, 3)]), null);
  });
  await t.test('accepts an empty list (a tenant may have no runways) and several runways', () => {
    assert.equal(validateRunwayGroups([]), null);
    assert.equal(validateRunwayGroups([group(false, 1), group(true, 2), group(true, 3)]), null);
  });
  await t.test('rejects 0 strips and 4 strips', () => {
    assert.match(validateRunwayGroups([group(false, 0)]), /1 to 3 strips/);
    assert.match(validateRunwayGroups([group(true, 4)]), /1 to 3 strips/);
  });
  await t.test('rejects a non-array strips value, non-object strips, and non-object groups', () => {
    assert.match(validateRunwayGroups([{ ...group(false, 1), strips: 'nope' }]), /strips must be an array/);
    assert.match(validateRunwayGroups([{ ...group(false, 1), strips: [null] }]), /each strip must be an object/);
    assert.match(validateRunwayGroups([{ ...group(false, 1), strips: [[1, 2]] }]), /each strip must be an object/);
    assert.match(validateRunwayGroups([null]), /must be an object/);
    assert.match(validateRunwayGroups('x'), /must be an array/);
  });
  await t.test('rejects a 3-strip runway whose twin flag is false', () => {
    assert.match(validateRunwayGroups([group(false, 3)]), /twin/);
  });
  await t.test('still accepts every shape saved before this rule (twin flag not forced to match 1-2 strips)', () => {
    assert.equal(validateRunwayGroups([group(false, 2)]), null);
    assert.equal(validateRunwayGroups([group(true, 1)]), null);
  });
  await t.test('names which runway is wrong', () => {
    assert.match(validateRunwayGroups([group(false, 1), group(true, 4)]), /^Runway 2:/);
  });
});

test('tenant/config.ts validates runway groups before it deletes anything', () => {
  const source = fs.readFileSync(path.join(root, 'functions/api/tenant/config.ts'), 'utf8');
  const validateAt = source.indexOf('validateRunwayGroups(body.runwayGroups)');
  const deleteAt = source.indexOf('DELETE FROM runway_groups');
  assert.ok(validateAt > -1, 'config.ts must call validateRunwayGroups');
  assert.ok(deleteAt > -1, 'expected the runway delete-and-reinsert to still exist');
  assert.ok(validateAt < deleteAt, 'validation must come before the destructive delete');
  const firstWrite = source.indexOf('.run()');
  assert.ok(validateAt < firstWrite, 'validation must come before the first write of the handler');
});
