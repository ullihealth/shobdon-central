// Range labels (migration 0119): prefix normalisation, the matching SQL
// (longest prefix wins, exact beats range, 187.40.50. never matches
// 187.40.5.x / 187.40.500.x), and the client-side suggestion helpers.
// The REAL SQL fragments from functions/api/_utils/ipRange.ts are run against
// an in-memory SQLite built from the real migration.
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
const server = await load('functions/api/_utils/ipRange.ts');
const client = await load('src/utils/ipRange.ts');
const { normaliseRangePrefix, rangeLabelJoin, EFFECTIVE_GROUP_SQL, UNLABELED_SQL, LABEL_SOURCE_SQL } = server;

test('normalise: IPv4 2 or 3 octets get a trailing dot', () => {
  assert.equal(normaliseRangePrefix('187.40.50'), '187.40.50.');
  assert.equal(normaliseRangePrefix('187.40.50.'), '187.40.50.');
  assert.equal(normaliseRangePrefix('187.40'), '187.40.');
  assert.equal(normaliseRangePrefix(' 010.040 '), '10.40.');
});
test('normalise: rejects single octets, full addresses, out-of-range and junk', () => {
  for (const bad of ['', '187', '187.40.50.11', '256.1.1', '187.40.x', '1..2', '187.40.50.11.2', 'abc']) assert.equal(normaliseRangePrefix(bad), null, bad);
});
test('normalise: IPv6 1 to 4 groups, lowercase, trailing colon, no "::"', () => {
  assert.equal(normaliseRangePrefix('2a00:d203:85fc:0'), '2a00:d203:85fc:0:');
  assert.equal(normaliseRangePrefix('2A00:D203:85FC:0000:'), '2a00:d203:85fc:0:');
  assert.equal(normaliseRangePrefix('2a00'), null); // no colon -> treated as IPv4, which it isn't
  assert.equal(normaliseRangePrefix('2a00:'), '2a00:');
  for (const bad of ['2a00:d203:85fc:0:1', '2a00::1', 'zz00:1', ':']) assert.equal(normaliseRangePrefix(bad), null, bad);
});

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'migrations/0119_ip_range_labels.sql'), 'utf8'));
  db.exec('CREATE TABLE ip_labels (id INTEGER PRIMARY KEY, ip_address TEXT UNIQUE, group_name TEXT, color TEXT)');
  db.exec('CREATE TABLE display_visits (id INTEGER PRIMARY KEY, ip_address TEXT, display_slug TEXT)');
  return db;
}
const effective = (db, ips) => {
  for (const ip of ips) db.prepare('INSERT INTO display_visits (ip_address, display_slug) VALUES (?, ?)').run(ip, 'main');
  const rows = db.prepare(`SELECT v.ip_address ip, ${EFFECTIVE_GROUP_SQL} grp, ${LABEL_SOURCE_SQL} src, ${UNLABELED_SQL} unl
    FROM display_visits v LEFT JOIN ip_labels l ON l.ip_address = v.ip_address ${rangeLabelJoin('v.ip_address')}`).all();
  return Object.fromEntries(rows.map((r) => [r.ip, [r.grp, r.src, r.unl]]));
};

test('matching: trailing dot stops 187.40.50. matching 187.40.5.1 or 187.40.500.1', () => {
  const db = makeDb();
  db.prepare("INSERT INTO ip_range_labels (prefix, group_name, created_at) VALUES ('187.40.50.', 'A', 'x')").run();
  const r = effective(db, ['187.40.50.11', '187.40.5.1', '187.40.500.1', '187.40.51.1', '9.9.9.9']);
  assert.deepEqual(r['187.40.50.11'], ['A', 'range', 0]);
  for (const ip of ['187.40.5.1', '187.40.500.1', '187.40.51.1', '9.9.9.9']) assert.deepEqual(r[ip], [null, null, 1], ip);
});

test('matching: longest prefix wins; exact beats range; IPv6 prefix matches', () => {
  const db = makeDb();
  db.prepare("INSERT INTO ip_range_labels (prefix, group_name, created_at) VALUES ('187.40.', 'Broad', 'x'), ('187.40.50.', 'Narrow', 'x'), ('2a00:d203:85fc:0:', 'V6', 'x'), ('2a00:d203:', 'V6broad', 'x')").run();
  db.prepare("INSERT INTO ip_labels (ip_address, group_name) VALUES ('187.40.50.99', 'Exact')").run();
  const r = effective(db, ['187.40.50.11', '187.40.7.7', '187.40.50.99', '2a00:d203:85fc:0:1:2:3:4', '2a00:d203:1:2:3:4:5:6', '2a00:d204::1']);
  assert.deepEqual(r['187.40.50.11'], ['Narrow', 'range', 0]);
  assert.deepEqual(r['187.40.7.7'], ['Broad', 'range', 0]);
  assert.deepEqual(r['187.40.50.99'], ['Exact', 'ip', 0]);
  assert.deepEqual(r['2a00:d203:85fc:0:1:2:3:4'], ['V6', 'range', 0]);
  assert.deepEqual(r['2a00:d203:1:2:3:4:5:6'], ['V6broad', 'range', 0]);
  assert.deepEqual(r['2a00:d204::1'], [null, null, 1]);
});

test('prefix is unique (re-saving a prefix re-points it, never duplicates)', () => {
  const db = makeDb();
  db.prepare("INSERT INTO ip_range_labels (prefix, group_name, created_at) VALUES ('1.2.', 'A', 'x')").run();
  assert.throws(() => db.prepare("INSERT INTO ip_range_labels (prefix, group_name, created_at) VALUES ('1.2.', 'B', 'x')").run());
});

test('client: range choices for IPv4 and IPv6', () => {
  assert.deepEqual(client.rangeChoicesForIp('187.40.50.11').map((c) => c.prefix), ['187.40.50.', '187.40.']);
  assert.deepEqual(client.rangeChoicesForIp('2a06:5906:3c2b:bc00:157e:1288:1b9:992e').map((c) => c.prefix), ['2a06:5906:3c2b:bc00:']);
  assert.deepEqual(client.rangeChoicesForIp('2a00::1'), []);
  assert.deepEqual(client.rangeChoicesForIp('not-an-ip'), []);
});

test('client: suggestions only for an address sharing the tight range with an exact label', () => {
  const labels = [
    { ipAddress: '148.252.128.252', groupName: 'FRED' },
    { ipAddress: '148.252.128.9', groupName: 'FRED' },
    { ipAddress: '148.252.128.77', groupName: 'OTHER' },
    { ipAddress: '10.0.0.1', groupName: 'X' },
  ];
  assert.equal(client.suggestRangeGroup('148.252.128.40', labels), 'FRED'); // most common in the /24
  assert.equal(client.suggestRangeGroup('148.252.129.40', labels), null); // different 3rd octet
  assert.equal(client.suggestRangeGroup('9.9.9.9', labels), null);
  assert.equal(client.suggestRangeGroup('2a00::1', labels), null);
  const v6 = [{ ipAddress: '2a06:5906:3c2b:bc00:aaaa:1:2:3', groupName: 'V6' }];
  assert.equal(client.suggestRangeGroup('2a06:5906:3c2b:bc00:1:2:3:4', v6), 'V6');
});
