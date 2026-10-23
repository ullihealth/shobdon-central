// Suspended-tenant back-office lock: server (functions/api/_utils/tenantAuth.ts
// requireTenant + its route allow-list) and client helpers
// (src/utils/subscriptionLock.ts). requireTenant is run for real against a fake
// D1 so every branch is covered: active / suspended / archived tenant x
// developer / non-developer user x allowed / locked route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const load = (file) => {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const auth = await load('functions/api/_utils/tenantAuth.ts');
const lock = await load('src/utils/subscriptionLock.ts');
const { requireTenant, requireOwner, requireDeveloper, isSuspendedTenantAllowedPath, SUSPENDED_TENANT_ALLOWED_PATHS, SUBSCRIPTION_NOT_ACTIVE_ERROR } = auth;

// Fake D1: answers the handful of queries requireTenant makes.
function makeDb({ active = 1, deletedAt = null, developer = 0, role = 'owner' } = {}) {
  const log = [];
  return {
    log,
    prepare(sql) {
      return {
        bind: (...args) => ({
          first: async () => {
            log.push(sql.split(/\s+/).slice(0, 8).join(' '));
            if (sql.includes('FROM session')) return { userId: 'u1', expiresAt: new Date(Date.now() + 3600e3).toISOString() };
            if (sql.includes('FROM member m JOIN organization o')) return { organizationId: 'org1', slug: 'tiger', name: 'Tiger', role };
            if (sql.includes('FROM tenants WHERE organization_id')) return { deletedAt, active };
            if (sql.includes('SELECT developer FROM user')) return { developer };
            return null;
          },
        }),
      };
    },
  };
}
const call = (db, pathname, fn = requireTenant) => fn(new Request(`https://tiger.example${pathname}`, { headers: { cookie: 'better-auth.session_token=tok.sig' } }), { DB: db });
const errBody = async (r) => ({ status: r.error.status, body: await r.error.json() });

test('exact allow-list: me, terms, media box consent, checkout - nothing else', () => {
  assert.deepEqual([...SUSPENDED_TENANT_ALLOWED_PATHS], ['/api/tenant/me', '/api/tenant/terms/accept', '/api/tenant/media-box-consent/accept', '/api/stripe/checkout']);
  for (const p of SUSPENDED_TENANT_ALLOWED_PATHS) assert.equal(isSuspendedTenantAllowedPath(p), true, p);
  assert.equal(isSuspendedTenantAllowedPath('/api/tenant/me/'), true, 'trailing slash tolerated');
  for (const p of ['/api/tenant/ops-panel', '/api/tenant/config', '/api/tenant/media-library/upload', '/api/tenant/pilot-view', '/api/tenant/carousel', '/api/tenant/members', '/api/tenant/me/extra', '/api/tenant/terms', '/api/tenant/switch-org', '/api/tenant/bug-reports']) {
    assert.equal(isSuspendedTenantAllowedPath(p), false, p);
  }
});

test('SUSPENDED + non-developer: every locked route is 403 {error: "Subscription not active"}', async () => {
  assert.equal(SUBSCRIPTION_NOT_ACTIVE_ERROR, 'Subscription not active');
  const db = makeDb({ active: 0, developer: 0 });
  for (const p of ['/api/tenant/ops-panel', '/api/tenant/config', '/api/tenant/media-library/upload', '/api/tenant/pilot-view', '/api/tenant/carousel', '/api/tenant/runways', '/api/tenant/members']) {
    const r = await call(db, p);
    assert.ok('error' in r, p);
    assert.deepEqual(await errBody(r), { status: 403, body: { error: 'Subscription not active' } }, p);
  }
});

test('the role wrappers (owner / developer routes) are locked too - they all go through requireTenant', async () => {
  const db = makeDb({ active: 0, developer: 0 });
  assert.equal((await errBody(await call(db, '/api/tenant/members', requireOwner))).body.error, 'Subscription not active');
  assert.equal((await errBody(await call(db, '/api/tenant/developer-settings', requireDeveloper))).body.error, 'Subscription not active');
});

test('SUSPENDED + non-developer: the allow-listed routes still work', async () => {
  const db = makeDb({ active: 0, developer: 0 });
  for (const p of SUSPENDED_TENANT_ALLOWED_PATHS) {
    const r = await call(db, p);
    assert.ok(!('error' in r), p);
    assert.equal(r.membership.organizationId, 'org1');
  }
});

test('SUSPENDED + DEVELOPER: completely unaffected on every route', async () => {
  const db = makeDb({ active: 0, developer: 1 });
  for (const p of ['/api/tenant/ops-panel', '/api/tenant/config', '/api/tenant/media-library/upload', '/api/tenant/me']) {
    assert.ok(!('error' in (await call(db, p))), p);
  }
});

test('ACTIVE tenant: unchanged, and no extra user query is made for non-lock cases', async () => {
  const db = makeDb({ active: 1, developer: 0 });
  assert.ok(!('error' in (await call(db, '/api/tenant/ops-panel'))));
  assert.ok(!db.log.some((q) => q.includes('SELECT developer FROM user')), 'the developer lookup only happens for a suspended tenant on a locked route');
  const suspendedAllowed = makeDb({ active: 0 });
  await call(suspendedAllowed, '/api/tenant/me');
  assert.ok(!suspendedAllowed.log.some((q) => q.includes('SELECT developer FROM user')), 'allow-listed path never needs it either');
});

test('ARCHIVED tenant keeps its stronger behaviour: 403 Forbidden for everyone on every route (even allow-listed, even developers via membership)', async () => {
  for (const developer of [0, 1]) {
    const db = makeDb({ active: 0, deletedAt: '2026-10-01T00:00:00Z', developer });
    for (const p of ['/api/tenant/ops-panel', '/api/tenant/me']) {
      assert.deepEqual(await errBody(await call(db, p)), { status: 403, body: { error: 'Forbidden' } }, `${p} developer=${developer}`);
    }
  }
});

test('payment does not resume the tenant: the Stripe webhook still never writes tenants.active', () => {
  const webhook = read('functions/api/stripe/webhook.ts');
  assert.ok(!/UPDATE tenants SET[^"`]*\bactive\s*=/.test(webhook.replace(/\/\/.*$/gm, '')), 'webhook has no UPDATE tenants ... active =');
  assert.match(webhook, /Never touches tenants\.active/);
});

test('/api/tenant/me exposes subscriptionActive (missing tenant row = active, never a lock)', () => {
  const me = read('functions/api/tenant/me.ts');
  assert.match(me, /subscriptionActive: tenantRow \? !!tenantRow\.active : true/);
});

// ---------------- client ----------------
test('client: locked only for a suspended tenant AND a non-developer; failures never lock', () => {
  const { isAdminLocked, isPathAllowedWhileLocked, SUBSCRIPTION_NOT_ACTIVE_MESSAGE } = lock;
  assert.equal(isAdminLocked({ subscriptionActive: false, isDeveloper: false }), true);
  assert.equal(isAdminLocked({ subscriptionActive: false, isDeveloper: true }), false);
  assert.equal(isAdminLocked({ subscriptionActive: true, isDeveloper: false }), false);
  for (const bad of [null, undefined, {}, { subscriptionActive: 'false' }, { subscriptionActive: 0 }, { isDeveloper: false }]) assert.equal(isAdminLocked(bad), false, JSON.stringify(bad));
  assert.equal(isPathAllowedWhileLocked('/account'), true);
  assert.equal(isPathAllowedWhileLocked('/account/'), true);
  for (const p of ['/media-manager', '/atc-control', '/runways', '/pilot-panel', '/config', '/members', '/help']) assert.equal(isPathAllowedWhileLocked(p), false, p);
  assert.equal(SUBSCRIPTION_NOT_ACTIVE_MESSAGE, 'Subscription not active. Your account is on hold — please activate your subscription to restore access.');
});

test('client wiring: layout swaps the page for the message, sidebar greys everything but My Account', () => {
  const layout = read('src/components/admin/AdminLayout.tsx');
  assert.match(layout, /isAdminLocked\(data\)/);
  assert.match(layout, /\{locked && <SubscriptionLockBanner \/>\}/);
  assert.match(layout, /blockPage \? <SubscriptionLockedPanel \/> : <Outlet \/>/);
  const sidebar = read('src/components/admin/AdminSidebar.tsx');
  assert.match(sidebar, /AdminSidebar\(\{ locked = false \}/);
  assert.match(sidebar, /locked=\{locked\}/);
  const group = read('src/components/admin/SidebarGroup.tsx');
  assert.match(group, /aria-disabled="true"/);
  // My Account / Log out live in SidebarUserMenu, which has no lock logic at all.
  assert.ok(!/locked/.test(read('src/components/admin/SidebarUserMenu.tsx')));
});
