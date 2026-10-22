// Pure-logic test for functions/api/_utils/londonDay.ts (the Visit Log's
// daily-devices counter): a UK local day -> its UTC window, across BST/GMT
// and both clock-change days. TS transpiled in memory, no server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'functions/api/_utils/londonDay.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { londonDayWindow } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('winter (GMT): London day == UTC day', () => {
  assert.deepEqual(londonDayWindow('2026-01-15'), { startIso: '2026-01-15T00:00:00.000Z', endIso: '2026-01-16T00:00:00.000Z' });
});

test('summer (BST): London day starts 23:00 UTC the evening before', () => {
  assert.deepEqual(londonDayWindow('2026-10-21'), { startIso: '2026-10-20T23:00:00.000Z', endIso: '2026-10-21T23:00:00.000Z' });
  assert.deepEqual(londonDayWindow('2026-07-01'), { startIso: '2026-06-30T23:00:00.000Z', endIso: '2026-07-01T23:00:00.000Z' });
});

test('clock-change days are 23h / 25h long', () => {
  // 2026-03-29: clocks go forward at 01:00 UTC -> 23-hour day.
  assert.deepEqual(londonDayWindow('2026-03-29'), { startIso: '2026-03-29T00:00:00.000Z', endIso: '2026-03-29T23:00:00.000Z' });
  // 2026-10-25: clocks go back at 01:00 UTC -> 25-hour day.
  assert.deepEqual(londonDayWindow('2026-10-25'), { startIso: '2026-10-24T23:00:00.000Z', endIso: '2026-10-26T00:00:00.000Z' });
});

test('a visit just after London midnight lands on the new London day', () => {
  const d21 = londonDayWindow('2026-10-21');
  const d22 = londonDayWindow('2026-10-22');
  const justAfterMidnightBst = '2026-10-21T23:05:00.000Z'; // 00:05 BST on the 22nd
  assert.ok(justAfterMidnightBst >= d22.startIso && justAfterMidnightBst < d22.endIso);
  assert.ok(!(justAfterMidnightBst >= d21.startIso && justAfterMidnightBst < d21.endIso));
  assert.equal(d21.endIso, d22.startIso, 'consecutive days tile with no gap or overlap');
});

test('invalid dates are rejected', () => {
  for (const bad of ['', '2026-13-01', '2026-02-30', '22-10-2026', '2026-10-2', 'x']) assert.equal(londonDayWindow(bad), null, bad);
});
