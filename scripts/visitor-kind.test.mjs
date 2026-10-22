// functions/api/_utils/visitorKind.ts - the Visit Log's robot / test-run /
// human classifier. Fixtures are real production user agents (every distinct
// robot and HeadlessChrome UA seen to date, plus a sample of real devices) and
// a few hand-written typical ones. Also checks the SQL expression agrees with
// the TypeScript function on every sample, using an in-memory SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'functions/api/_utils/visitorKind.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { visitorKind, visitorKindSql, ROBOT_PATTERNS, TEST_PATTERNS } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/visitor-user-agents.json'), 'utf8'));

test('every production robot user agent classifies as robot', () => {
  assert.ok(fixtures.robots.length >= 8);
  for (const ua of fixtures.robots) assert.equal(visitorKind(ua), 'robot', ua);
});

test('HeadlessChrome classifies as test (never robot), on Mac and Linux', () => {
  assert.ok(fixtures.tests.length >= 2);
  for (const ua of fixtures.tests) assert.equal(visitorKind(ua), 'test', ua);
});

test('real devices (iPhone, Android, Mac Chrome/Safari, Windows, Pi X11 Linux) are human', () => {
  assert.ok(fixtures.humans.length >= 20);
  for (const ua of fixtures.humans) assert.equal(visitorKind(ua), 'human', ua);
});

test('null / empty user agent is human; matching is case-insensitive', () => {
  assert.equal(visitorKind(null), 'human');
  assert.equal(visitorKind(''), 'human');
  assert.equal(visitorKind('SOMETHING GOOGLEBOT/2.1'), 'robot');
  assert.equal(visitorKind('x HEADLESSCHROME/1'), 'test');
});

test('named crawlers from the brief are all covered by the pattern list', () => {
  for (const name of ['Googlebot', 'Google-Read-Aloud', 'meta-webindexer', 'Applebot', 'bingbot', 'ExaSearchBot', 'Reflectionbot', 'facebookexternalhit', 'Yahoo! Slurp', 'SomeSpider', 'LinkPreview']) {
    assert.equal(visitorKind(`Mozilla/5.0 (compatible; ${name}/1.0)`), 'robot', name);
  }
  assert.ok(ROBOT_PATTERNS.every((p) => p === p.toLowerCase() && !/[%_']/.test(p)), 'patterns must be lowercase with no LIKE wildcards or quotes');
  assert.ok(TEST_PATTERNS.every((p) => p === p.toLowerCase() && !/[%_']/.test(p)));
});

test('SQL expression agrees with the TypeScript classifier on every sample', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE v (user_agent TEXT)');
  const all = [...fixtures.robots, ...fixtures.tests, ...fixtures.humans, null, '', 'SOMETHING GOOGLEBOT/2.1', 'x HEADLESSCHROME/1'];
  const insert = db.prepare('INSERT INTO v (user_agent) VALUES (?)');
  for (const ua of all) insert.run(ua);
  const rows = db.prepare(`SELECT user_agent AS ua, ${visitorKindSql('user_agent')} AS kind FROM v`).all();
  assert.equal(rows.length, all.length);
  for (const row of rows) assert.equal(row.kind, visitorKind(row.ua), String(row.ua));
});
