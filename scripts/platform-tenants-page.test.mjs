// Platform Tenants page reorganisation: pure status/filter/search logic, plus
// source guards that every old control is still wired and that the page
// changes nothing server-side. Real-browser click-testing is run separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const load = async (file) => {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const S = await load('src/components/platform/tenants/tenantStatus.ts');

const NOW = Date.parse('2026-10-23T12:00:00Z');
const tenant = (over = {}) => ({
  id: 1, slug: 'acme', name: 'Acme Flying Club', subdomain: 'acme', active: true, isInternal: false,
  subscriptionStatus: 'trial', hasStripeSubscription: false, members: [], mediaBoxIdentifier: null, deletedAt: null, ...over,
});
const unit = (over = {}) => ({ id: 9, serialNumber: 'PI-0042', tenantId: 1, tenantName: null, status: 'active', tvScheduleLastSeenAt: null, ...over });
const labels = (t) => S.statusBadges(t).map((b) => b.label);

test('status badges: suspended, awaiting activation, paid awaiting resume, no subscription, internal, active', () => {
  assert.deepEqual(labels(tenant({ active: false })), ['Suspended', 'Awaiting activation']);
  assert.deepEqual(labels(tenant({ active: false, subscriptionStatus: 'active', hasStripeSubscription: true })), ['Suspended', 'Paid - awaiting Resume']);
  assert.deepEqual(labels(tenant()), ['No subscription']);
  assert.deepEqual(labels(tenant({ subscriptionStatus: 'active', hasStripeSubscription: true })), ['Active']);
  assert.deepEqual(labels(tenant({ isInternal: true })), ['Active', 'Internal']);
  assert.deepEqual(labels(tenant({ isInternal: true, active: false })), ['Suspended', 'Awaiting activation', 'Internal']);
  assert.deepEqual(labels(tenant({ deletedAt: '2026-10-01' })), ['Archived']);
  const tones = Object.fromEntries(S.statusBadges(tenant({ active: false })).map((b) => [b.label, b.tone]));
  assert.equal(tones['Suspended'], 'red');
  assert.equal(tones['Awaiting activation'], 'amber');
  assert.equal(S.planBadge(tenant({ hasStripeSubscription: true })).tone, 'blue');
  assert.equal(S.planBadge(tenant()), null);
});

test('no badge or filter ever says Complimentary (that marker does not exist yet)', () => {
  const all = JSON.stringify([...S.FILTERS, S.statusBadges(tenant({ subscriptionStatus: 'comped' }))]);
  assert.ok(!/complimentary/i.test(all));
});

test('filters: paying, suspended, internal, no subscription, all', () => {
  const ts_ = [
    tenant({ id: 1, subscriptionStatus: 'active', hasStripeSubscription: true }),
    tenant({ id: 2, active: false }),
    tenant({ id: 3, isInternal: true }),
    tenant({ id: 4 }),
    tenant({ id: 5, active: false, isInternal: true }),
  ];
  const c = S.filterCounts(ts_, [], NOW);
  assert.equal(c.all, 5);
  assert.equal(c.paying, 1);
  assert.equal(c.suspended, 2);
  assert.equal(c.internal, 2);
  assert.equal(c.none, 1, 'No subscription = not internal, not paying, not suspended');
});

test('needs attention: suspended, no subscription, past due, paid awaiting resume, Pi offline over an hour', () => {
  const ids = (t, u = []) => S.tenantIssues(t, u, NOW).map((i) => i.id);
  assert.ok(ids(tenant({ active: false })).includes('suspended'));
  assert.ok(ids(tenant()).includes('no-subscription'));
  assert.ok(!ids(tenant({ isInternal: true })).includes('no-subscription'), 'internal tenants need no subscription');
  assert.ok(!ids(tenant({ subscriptionStatus: 'comped' })).includes('no-subscription'));
  assert.ok(ids(tenant({ subscriptionStatus: 'past_due' })).includes('past-due'));
  assert.deepEqual(ids(tenant({ active: false, subscriptionStatus: 'active', hasStripeSubscription: true })), ['paid-awaiting-resume']);
  assert.deepEqual(ids(tenant({ subscriptionStatus: 'active', hasStripeSubscription: true })), []);
  const old = new Date(NOW - 2 * 3600e3).toISOString();
  const recent = new Date(NOW - 20 * 60e3).toISOString();
  const paid = { subscriptionStatus: 'active', hasStripeSubscription: true };
  assert.ok(ids(tenant(paid), [unit({ tvScheduleLastSeenAt: old })]).some((i) => i.startsWith('pi-offline')));
  assert.deepEqual(ids(tenant(paid), [unit({ tvScheduleLastSeenAt: recent })]), [], 'offline but under an hour is not flagged');
  assert.deepEqual(ids(tenant(paid), [unit({ tvScheduleLastSeenAt: null })]), [], 'never seen is not flagged');
  assert.deepEqual(S.tenantIssues(tenant({ deletedAt: '2026-10-01', active: false }), [], NOW), []);
});

test('Pi box state: online within 5 minutes, offline after, unknown without a check-in', () => {
  assert.equal(S.piState(unit({ tvScheduleLastSeenAt: new Date(NOW - 60e3).toISOString() }), NOW), 'online');
  assert.equal(S.piState(unit({ tvScheduleLastSeenAt: new Date(NOW - 10 * 60e3).toISOString() }), NOW), 'offline');
  assert.equal(S.piState(unit(), NOW), 'unknown');
  assert.equal(S.piState(undefined, NOW), 'unknown');
});

test('search: name, slug, member email, Media Box id and linked Pi serial; all words must match', () => {
  const t = tenant({ members: [{ id: 'm', email: 'pat@example.org', name: 'Pat', role: 'owner', createdAt: '' }], mediaBoxIdentifier: 'MB-77' });
  const u = [unit()];
  for (const q of ['acme', 'ACME flying', 'pat@example', 'mb-77', 'pi-0042', '']) assert.ok(S.matchesSearch(t, q, u), q);
  for (const q of ['zzz', 'acme zzz']) assert.ok(!S.matchesSearch(t, q, u), q);
});

test('recent tenants survive missing or broken localStorage', () => {
  globalThis.window = { localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } };
  assert.deepEqual(S.readRecentTenants(), []);
  S.rememberRecentTenant('acme');
  const store = {};
  globalThis.window = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  S.rememberRecentTenant('a'); S.rememberRecentTenant('b'); S.rememberRecentTenant('a');
  assert.deepEqual(S.readRecentTenants(), ['a', 'b']);
});

// ---------- source guards: nothing is lost, nothing server-side changes ----------
const editors = read('src/components/platform/tenants/tenantEditors.tsx');
const tabs = read('src/components/platform/tenants/TenantTabs.tsx');
const tenantPage = read('src/pages/PlatformTenantPage.tsx');
const listPage = read('src/pages/PlatformTenantsListPage.tsx');
const store = read('src/components/platform/tenants/TenantsContext.tsx');
const inUi = (needle) => [tabs, tenantPage, listPage].some((s) => s.includes(needle));

test('every old control is still rendered somewhere on the new pages', () => {
  const controls = [
    'NameEditor', 'LogoEditor', 'ActivationLinkSection', 'MediaBoxIssuedEditor', 'QuotaEditor', 'CarouselBudgetEditor',
    'AfisoFrequencyEditor', 'QrTargetUrlEditor', 'QrCaptionTextEditor', 'QrMockupEditor', 'ParentAirfieldEditor',
    'RefreshDisplaysButton', 'ForcePilotUpdateButton', 'LogEveryoneOutButton', 'useLogEveryoneOut', 'PrimaryCameraEditor',
    'PilotTickerSlotsEditor', 'MediaScreenEntitlementEditor', 'QnhQfeOffsetEditor', 'DisplayControls', 'MembersSection',
    'SubscriptionEditor', 'HistoryEntryRow', 'HardDeleteSection', 'NewSignupsBadge', 'OnboardTenantPanel',
    'handleSuspendToggle', 'handleArchiveTenant', 'handleRefreshAllDisplays', 'handleForcePilotUpdateAll',
  ];
  for (const c of controls) assert.ok(inUi(c), `${c} is no longer used`);
  for (const f of ['dashboardEnabled', 'carouselBudgetEnabled', 'fullBufferGateEnabled', 'qrSlideEnabled', 'hasPhysicalAtc', 'afisoOpen', 'mobileEnabled', 'weatherPublic', 'opsPublic', 'isInternal', 'globalLinkEnabled']) {
    assert.ok(tabs.includes(`'${f}'`), `toggle ${f} missing`);
  }
  assert.ok(tabs.includes('/platform/onboarding-content') || listPage.includes('/platform/onboarding-content'));
  assert.ok(tabs.includes('carousel-owner-slots') && tabs.includes('cafe-carousel-owner-slots'), 'Manage reserved slots links kept');
});

test('toggles still save with the same single-field PATCH, and revert on failure', () => {
  assert.match(store, /patchTenant\(tenant\.id, \{ \[field\]: next \}\)/);
  assert.match(store, /\[field\]: !next/);
  assert.match(editors, /method: 'PATCH'/);
  assert.match(editors, /\$\{TENANTS_URL\}\/\$\{id\}/);
});

test('Suspend, Resume and Log everyone out keep their confirmations; Archive needs the typed name', () => {
  assert.match(store, /window\.confirm\(message\)/);
  assert.match(editors, /Log everyone out of \$\{tenant\.name\}\?/);
  assert.match(tenantPage, /typed\.trim\(\) === tenant\.name\.trim\(\)/);
  assert.match(tenantPage, /Danger zone/);
  assert.ok(!/window\.confirm/.test(tenantPage), 'Archive no longer uses a plain OK');
  assert.match(store, /archived: true/);
});

test('Resume stays manual: nothing on these pages resumes a tenant automatically', () => {
  for (const s of [store, tabs, tenantPage, listPage]) assert.ok(!/active: true/.test(s), 'no automatic resume');
});

test('routes: list, per-tenant slug page, and the existing carousel-owner-slots route', () => {
  const app = read('src/App.tsx');
  assert.match(app, /path="\/platform\/tenants" element=\{<PlatformTenantsPage \/>\}/);
  assert.match(app, /<Route index element=\{<PlatformTenantsListPage \/>\} \/>/);
  assert.match(app, /<Route path=":slug" element=\{<PlatformTenantPage \/>\} \/>/);
  assert.match(app, /\/platform\/tenants\/:id\/carousel-owner-slots/);
});

test('no backend, schema or billing code changed for this page', () => {
  // The page only calls routes that already existed.
  const calls = [...(editors + store + tenantPage).matchAll(/['`](\/api\/platform\/[a-z0-9\-/${}.A-Za-z]*)/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, ':x'));
  assert.ok(calls.length > 0);
  for (const c of new Set(calls)) {
    const rel = c.replace(/^\/api\//, 'functions/api/').split('/').slice(0, 5).join('/');
    assert.ok(fs.existsSync(path.join(root, rel.split('/:x')[0])) || fs.existsSync(path.join(root, rel.split('/:x')[0] + '.ts')), `route ${c} must already exist (${rel})`);
  }
});

function stripComments(src) {
  let out = '', i = 0, state = null;
  const n = src.length;
  while (i < n) {
    const c = src[i], nx = src[i + 1];
    if (state === null) {
      if (c === '/' && nx === '/' && src[i - 1] !== ':') { const j = src.indexOf('\n', i); const e = j < 0 ? n : j; out += ' '.repeat(e - i); i = e; continue; }
      if (c === '/' && nx === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? n : j + 2; out += src.slice(i, e).replace(/[^\n]/g, ' '); i = e; continue; }
      if (c === "'" || c === '"' || c === '`') state = c;
      out += c; i += 1; continue;
    }
    out += c;
    if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
    if (c === state) state = null;
    i += 1;
  }
  return out;
}

test('stale Parent Airfield help text is gone and no long dashes in this page\'s text', () => {
  assert.ok(!/must still be set/.test(editors) && !/Third-Party Station/.test(editors));
  for (const f of ['src/components/platform/tenants/tenantEditors.tsx', 'src/components/platform/tenants/TenantTabs.tsx', 'src/components/platform/tenants/TenantUi.tsx', 'src/components/platform/tenants/QuickSwitcher.tsx', 'src/components/platform/tenants/OnboardTenantPanel.tsx', 'src/components/platform/tenants/TenantsContext.tsx', 'src/components/platform/tenants/tenantStatus.ts', 'src/pages/PlatformTenantPage.tsx', 'src/pages/PlatformTenantsListPage.tsx', 'src/pages/PlatformTenantsPage.tsx']) {
    const bad = stripComments(read(f)).split('\n').filter((l) => /[\u2014\u2013]/.test(l));
    assert.deepEqual(bad, [], f);
  }
});

test('touch targets and phone layout: tabs scroll, table scrolls inside its own box, 44px controls', () => {
  assert.match(tenantPage, /overflow-x-auto/);
  assert.match(listPage, /overflow-x-auto rounded-2xl/);
  assert.match(tenantPage, /min-h-\[44px\]/);
  assert.match(tenantPage, /\[&_button\]:min-h-\[44px\]/);
  assert.match(read('src/components/admin/DeveloperLayout.tsx'), /lg:hidden/);
});

test('quick switcher: Cmd/Ctrl+K, arrows, Enter, Esc, recents in try/catch localStorage', () => {
  const sw = read('src/components/platform/tenants/QuickSwitcher.tsx');
  const shell = read('src/pages/PlatformTenantsPage.tsx');
  assert.match(shell, /event\.metaKey \|\| event\.ctrlKey/);
  for (const k of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) assert.ok(sw.includes(`'${k}'`), k);
  assert.match(read('src/components/platform/tenants/tenantStatus.ts'), /try \{[\s\S]*localStorage[\s\S]*catch/);
});
