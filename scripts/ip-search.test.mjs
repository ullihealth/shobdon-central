// Pure-logic tests for the Visit Log IP search: src/utils/ipSearch.ts (box ->
// prefix, paste parsing) and functions/api/_utils/ipPrefix.ts (LIKE escaping).
// TS transpiled in memory; the LIKE clause is also exercised against an
// in-memory SQLite to prove % and _ in input are matched literally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const { buildIpPrefix, parsePastedIp, digitsOnly } = await load('src/utils/ipSearch.ts');
const { ipPrefixCondition } = await load('functions/api/_utils/ipPrefix.ts');

test('prefix building: finished octets get a dot, the octet being typed does not', () => {
  assert.equal(buildIpPrefix(['', '', '', '']), '');
  assert.equal(buildIpPrefix(['148', '', '', '']), '148.');
  assert.equal(buildIpPrefix(['148', '252', '', '']), '148.252.');
  assert.equal(buildIpPrefix(['148', '25', '', '']), '148.25');
  assert.equal(buildIpPrefix(['14', '', '', '']), '14');
  assert.equal(buildIpPrefix(['187', '192', '1', '3']), '187.192.1.3');
  assert.equal(buildIpPrefix(['187', '192', '1', '']), '187.192.1');
  assert.equal(buildIpPrefix(['187', '192', '213', '']), '187.192.213.');
  assert.equal(buildIpPrefix(['84', '45', '182', '217']), '84.45.182.217'); // no trailing dot on the 4th box
});

test('stops at the first empty box', () => {
  assert.equal(buildIpPrefix(['148', '', '5', '']), '148.');
  assert.equal(buildIpPrefix(['', '252', '', '']), '');
});

test('digits only, max 3', () => {
  assert.equal(digitsOnly('1a8b7c9'), '187');
  assert.equal(digitsOnly('12'), '12');
});

test('paste: full and partial addresses fill from the first box, wherever pasted', () => {
  assert.deepEqual(parsePastedIp('187.192.1.3', 2), { boxes: ['187', '192', '1', '3'], focusIndex: 3 });
  assert.deepEqual(parsePastedIp('148.252', 3), { boxes: ['148', '252', '', ''], focusIndex: 2 });
  assert.deepEqual(parsePastedIp(' 148.252.\n', 0), { boxes: ['148', '252', '', ''], focusIndex: 2 });
  assert.deepEqual(parsePastedIp('187.192.1.3.99', 0).boxes, ['187', '192', '1', '3']);
  assert.deepEqual(parsePastedIp('212', 1), { boxes: ['', '212', '', ''], focusIndex: 1 });
});

test('paste: anything with ":" switches to the IPv6 text field', () => {
  assert.deepEqual(parsePastedIp('2a00:23c8:1::5', 0), { ipv6: '2a00:23c8:1::5' });
});

test('LIKE condition: empty -> none; %, _ and backslash are escaped', () => {
  assert.equal(ipPrefixCondition(''), null);
  assert.equal(ipPrefixCondition(null), null);
  assert.equal(ipPrefixCondition('  '), null);
  assert.equal(ipPrefixCondition('148.252.').binding, '148.252.%');
  assert.equal(ipPrefixCondition('a%b_c\\d').binding, 'a\\%b\\_c\\\\d%');
});

test('LIKE condition against SQLite: starts-with only, wildcards are literal', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE v (ip_address TEXT)');
  const ins = db.prepare('INSERT INTO v VALUES (?)');
  for (const ip of ['148.252.128.252', '148.25.1.1', '148.252.5.5', '1148.252.1.1', '212.23.215.9', '84.45.182.217', '84.45.182.2171', '2a00:23c8::1']) ins.run(ip);
  const q = (prefix) => { const c = ipPrefixCondition(prefix, 'ip_address'); return db.prepare(`SELECT ip_address FROM v WHERE ${c.sql} ORDER BY 1`).all(c.binding).map((r) => r.ip_address); };
  assert.deepEqual(q('148.252.'), ['148.252.128.252', '148.252.5.5']);
  assert.deepEqual(q('148.25'), ['148.25.1.1', '148.252.128.252', '148.252.5.5']);
  assert.deepEqual(q('84.45.182.217'), ['84.45.182.217', '84.45.182.2171']); // prefix semantics, as specified
  assert.deepEqual(q('2a00:'), ['2a00:23c8::1']);
  assert.deepEqual(q('%'), []);
  assert.deepEqual(q('1_8'), []);
});
