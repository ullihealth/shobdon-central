// "Admin tabs always run the latest code" + live status + Billing wording + the
// no-long-dashes rule. Pure logic and source guards; the real-browser behaviour
// (old tab, new tab, deploy while dirty, suspend/resume within a minute) is run
// separately against a local server with real service workers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const load = async (file, extra = '') => {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(extra + js).toString('base64')}`);
};

// ---------- version check ----------
globalThis.window = { setTimeout, clearTimeout, location: { origin: 'http://x' } };
const ver = await load('src/lib/appVersion.ts', 'globalThis.__BUILD_ID__ = "build-A";\n');

test('reload only when the latest id is known, different, and not already reloaded for', () => {
  const { shouldReloadForBuild } = ver;
  assert.equal(shouldReloadForBuild('A', 'B', null), true);
  assert.equal(shouldReloadForBuild('A', 'A', null), false, 'same build');
  assert.equal(shouldReloadForBuild('A', null, null), false, 'failed check does nothing');
  assert.equal(shouldReloadForBuild('A', 'B', 'B'), false, 'at most one reload per new build id');
  assert.equal(shouldReloadForBuild('A', 'C', 'B'), true, 'a still newer build is a new id');
  assert.equal(shouldReloadForBuild('dev', 'B', null), false, 'a dev server never reloads');
});

test('a failed version fetch (offline / server error / junk) resolves null', async () => {
  const { fetchLatestBuildId } = ver;
  for (const impl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ nope: 1 }) }),
    async () => ({ ok: true, json: async () => { throw new Error('html, not json'); } }),
  ]) {
    globalThis.fetch = impl;
    assert.equal(await fetchLatestBuildId(50), null);
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ buildId: 'abc123' }) });
  assert.equal(await fetchLatestBuildId(50), 'abc123');
});

test('build id: baked into the bundle and published as /version.json by every vite build, uncached', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /CF_PAGES_COMMIT_SHA \|\| process\.env\.GITHUB_SHA/);
  assert.match(vite, /define: \{ __BUILD_ID__: JSON\.stringify\(BUILD_ID\) \}/);
  assert.match(vite, /fileName: 'version\.json'/);
  assert.match(read('public/_headers'), /\/version\.json\s+Cache-Control: no-store/);
});

// ---------- safe moment ----------
test('safe-to-reload tracking: edits, in-flight saves and uploads defer; a successful save clears', async () => {
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  const g = await load('src/lib/unsavedWorkGuard.ts');
  g.resetUnsavedWorkState();
  assert.equal(g.isSafeToReload(), true);
  g.noteWriteStart();
  assert.equal(g.isSafeToReload(), false, 'a save / upload in flight');
  g.noteWriteEnd(true);
  assert.equal(g.isSafeToReload(), true);
  assert.equal(g.isTrackedWrite('PUT', '/api/tenant/ops-panel'), true);
  assert.equal(g.isTrackedWrite('POST', '/api/tenant/media-library/upload'), true);
  assert.equal(g.isTrackedWrite('GET', '/api/tenant/me'), false);
  assert.equal(g.isTrackedWrite('POST', '/somewhere/else'), false);
  g.noteWriteStart(); g.noteWriteEnd(false);
  assert.equal(g.isSafeToReload(), true, 'a failed write is no longer in flight');
});

test('AdminLayout wiring: focus / visibility / 5 min version check; deferred update; one reload per build; 60 s status check', () => {
  const l = read('src/components/admin/AdminLayout.tsx');
  assert.match(l, /VERSION_CHECK_INTERVAL_MS/);
  assert.match(l, /addEventListener\('focus', onFocus\)/);
  assert.match(l, /addEventListener\('visibilitychange', onVisible\)/);
  assert.match(l, /shouldReloadForBuild\(CURRENT_BUILD_ID, latest, getReloadedFor\(\)\)/);
  assert.match(l, /markReloadedFor\(buildId\)/);
  assert.match(l, /!isSafeToReload\(\)\) return/);
  assert.match(l, /Updating to the latest version\.\.\./);
  assert.match(l, /await activateLatestWorker\(\)/, 'the new service worker is activated before the reload');
  assert.match(l, /const STATUS_CHECK_INTERVAL_MS = 60_000/);
  assert.match(l, /document\.visibilityState === 'visible'\) refreshMe\(\)/, 'status checks pause while hidden');
  assert.match(l, /applyUpdate\(buildId, `\$\{location\.pathname\}/, 'a deferred update is applied at the next navigation');
});

test('full page load to /login and to the landing page (never a client-side navigate)', () => {
  const ra = read('src/components/RequireAuth.tsx');
  assert.match(ra, /if \(!session\) \{\s*window\.location\.assign\('\/login'\)/);
  assert.ok(!/<Navigate to="\/login"/.test(ra));
  const lp = read('src/pages/LoginPage.tsx');
  assert.equal((lp.match(/navigate\(/g) || []).filter(Boolean).length, 0 + (lp.match(/\/\/[^\n]*navigate\(/g) || []).length);
  assert.match(lp, /window\.location\.assign\(path\)/);
  assert.match(lp, /activateLatestWorker\(6000\)/);
  assert.match(read('src/components/admin/AdminLayout.tsx'), /window\.location\.assign\('\/login'\)/);
  for (const f of ['src/components/admin/SidebarUserMenu.tsx', 'src/components/admin/SubscriptionTakeover.tsx', 'src/pages/AccountPage.tsx']) {
    assert.ok(!/navigate\('\/login'\)/.test(read(f)), f);
    assert.match(read(f), /window\.location\.assign\('\/login'\)/, f);
  }
});

test('the two protected mechanisms are untouched: dashboards RemoteRefreshWatcher / serviceWorkerUpdate and the Pilot\'s App worker', () => {
  const lib = read('src/lib/appVersion.ts');
  assert.ok(!/serviceWorkerUpdate|RemoteRefreshWatcher|pilot-sw/.test(lib.replace(/\/\/.*$/gm, '')), 'appVersion.ts does not import or call them');
});

// ---------- Billing wording ----------
const bs = await load('src/utils/billingStatus.ts');
const status = (o) => bs.customerStatusLabel({ tenantActive: true, paymentReceived: false, subscriptionStatus: 'active', stripeStatus: null, ...o });

test('customer status labels: never "Trial"; suspended/unpaid = "Not active - awaiting activation"', () => {
  assert.equal(status({ tenantActive: false, subscriptionStatus: 'trial' }), 'Not active - awaiting activation');
  assert.equal(status({ tenantActive: false, subscriptionStatus: 'active', paymentReceived: true }), 'Payment received - your account will be reactivated shortly');
  assert.equal(status({ subscriptionStatus: 'active', stripeStatus: 'active' }), 'Active');
  assert.equal(status({ subscriptionStatus: 'past_due' }), 'Payment failed - please update your card');
  assert.equal(status({ stripeStatus: 'past_due' }), 'Payment failed - please update your card');
  assert.equal(status({ stripeStatus: 'unpaid' }), 'Payment failed - please update your card');
  assert.equal(status({ subscriptionStatus: 'cancelled' }), 'Cancelled');
  assert.equal(status({ stripeStatus: 'canceled' }), 'Cancelled');
  assert.equal(status({ subscriptionStatus: 'pending' }), 'Awaiting payment');
  assert.equal(status({ stripeStatus: 'incomplete' }), 'Awaiting payment');
  assert.equal(status({ subscriptionStatus: 'comped' }), 'Active');
  assert.equal(status({ subscriptionStatus: 'trial' }), 'Active', 'a live tenant on the internal trial state shows Active');
  assert.equal(status({ stripeStatus: 'trialing' }), 'Active');
  for (const sub of ['trial', 'active', 'past_due', 'cancelled', 'comped', 'pending', 'weird']) for (const act of [true, false]) {
    assert.ok(!/trial/i.test(status({ subscriptionStatus: sub, tenantActive: act })), `${sub}/${act}`);
  }
  assert.ok(!/STATUS_LABELS|Trial/.test(read('src/pages/BillingPage.tsx')), 'the old internal-wording map is gone');
});

test('developers see Billing read-only; checkout and portal refuse them; tenants stay owner/admin only', () => {
  assert.match(read('functions/api/tenant/billing/status.ts'), /isDeveloper \|\| \["owner", "admin"\]|!isDeveloper && !\["owner", "admin"\]/);
  for (const f of ['checkout', 'portal']) {
    const src = read(`functions/api/tenant/billing/${f}.ts`);
    assert.match(src, /developer_read_only/, f);
    assert.match(src, /requireOwner\(request, env\)/, f);
  }
  assert.match(read('src/components/admin/AdminSidebar.tsx'), /item\.allowDeveloper && isDeveloper/);
  assert.match(read('src/components/admin/sidebarConfig.ts'), /label: 'Billing', allowedRoles: \['owner', 'admin'\], allowDeveloper: true/);
  assert.match(read('src/components/RequireAuth.tsx'), /\(!!allowDeveloper && meCheck\.isDeveloper\)/);
  assert.match(read('src/pages/BillingPage.tsx'), /Read-only view for developers/);
});

// ---------- no long dashes in customer-facing text ----------
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
// Developer-only screens (Platform admin pages, Visit Log, Known Devices, IP Directory,
// Uptime / Capture history, prototypes) are internal, not customer-facing.
const INTERNAL = /(Platform[A-Za-z]*Page|DeveloperToolsPage|KnownDevicesPage|IpDirectoryPage|UptimeReportPage|CaptureHistoryPage|RunwayWidgetTestPage|DailyDevicesCounter)\.tsx$/;
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!['generated', 'node_modules'].includes(e.name)) walk(rel, acc); }
    else if (/\.(tsx?|html)$/.test(e.name)) acc.push(rel);
  }
  return acc;
}
test('no em / en dashes in customer-facing code strings (comments and developer-only screens exempt)', () => {
  const files = [...walk('src'), ...walk('functions'), 'index.html', 'worker/src/index.ts'].filter((f) => !INTERNAL.test(f));
  const offenders = [];
  for (const f of files) {
    const code = f.endsWith('.html') ? read(f).replace(/<!--[\s\S]*?-->/g, '') : stripComments(read(f));
    code.split('\n').forEach((line, i) => { if (/[—–]/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`); });
  }
  assert.deepEqual(offenders, []);
});

test('CLAUDE.md carries the no-long-dashes rule, word for word', () => {
  assert.ok(read('CLAUDE.md').includes('## No long dashes in customer-facing text\nNever use em dashes (—) or en dashes (–) in any text a customer, pilot or member of the public can see (UI, messages, emails, display screens, Pi box pages). Use a plain hyphen with spaces ( - ) or rewrite the sentence. Code comments are exempt.'));
});
