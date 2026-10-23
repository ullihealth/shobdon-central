// Suspended-tenant experience: "Log everyone out" (session revocation), the
// takeover page, the central fetch guard, the billing routes and the Platform
// Tenants badge. Pure-logic + source guards + the real revoke SQL run in an
// in-memory SQLite; the end-to-end behaviour is covered by the real-browser run
// described in the commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const load = (file) => {
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const { revokeNonDeveloperSessions } = await load('functions/api/_utils/revokeTenantSessions.ts');
const { priceIdForPlan, PLANS_WITH_MEDIA_BOX } = await load('functions/api/_utils/billingPlan.ts');
const { isStripeFailure } = await load('functions/api/_utils/stripeApi.ts');

// ---------- session revocation (the REAL SQL against SQLite) ----------
function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, developer INTEGER DEFAULT 0);
           CREATE TABLE organization (id TEXT PRIMARY KEY);
           CREATE TABLE member (id TEXT PRIMARY KEY, userId TEXT, organizationId TEXT);
           CREATE TABLE tenants (id INTEGER PRIMARY KEY, organization_id TEXT);
           CREATE TABLE session (id TEXT PRIMARY KEY, userId TEXT, token TEXT);`);
  db.exec(`INSERT INTO organization VALUES ('orgT'),('orgO');
           INSERT INTO tenants VALUES (1,'orgT'),(2,'orgO');
           INSERT INTO user VALUES ('tenantOwner','o@t',0),('tenantAtc','a@t',0),('dev','dev@x',1),('otherUser','u@o',0),('both','b@x',0),('loner','l@x',0);
           INSERT INTO member VALUES ('m1','tenantOwner','orgT'),('m2','tenantAtc','orgT'),('m3','dev','orgT'),('m4','otherUser','orgO'),('m5','both','orgT'),('m6','both','orgO'),('m7','dev','orgO');
           INSERT INTO session VALUES ('s1','tenantOwner','t1'),('s2','tenantOwner','t2'),('s3','tenantAtc','t3'),('s4','dev','t4'),('s5','otherUser','t5'),('s6','both','t6'),('s7','loner','t7');`);
  const adapter = { prepare: (sql) => ({ bind: (...args) => ({ first: async () => db.prepare(sql).get(...args), run: async () => db.prepare(sql).run(...args) }) }) };
  return { db, adapter };
}

test('"Log everyone out": revokes the tenant\'s non-developer members only', async () => {
  const { db, adapter } = seed();
  const result = await revokeNonDeveloperSessions(adapter, 1);
  assert.deepEqual(result, { users: 3, sessions: 4, alsoMemberOfOtherTenants: 1 }); // owner(2) + atc(1) + both(1); 'both' is also in orgO
  const left = db.prepare('SELECT userId FROM session ORDER BY userId').all().map((r) => r.userId);
  assert.deepEqual(left, ['dev', 'loner', 'otherUser'], 'developer, other tenant\'s user and a non-member keep their sessions');
});

test('revocation never touches developers even though they are members of the tenant', async () => {
  const { db, adapter } = seed();
  await revokeNonDeveloperSessions(adapter, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM session WHERE userId = 'dev'").get().c, 1);
});

test('revoking another tenant leaves this tenant alone', async () => {
  const { db, adapter } = seed();
  await revokeNonDeveloperSessions(adapter, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM session WHERE userId IN ('tenantOwner','tenantAtc')").get().c, 3);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM session WHERE userId = 'otherUser'").get().c, 0);
});

test('idempotent: a second revoke finds nothing', async () => {
  const { adapter } = seed();
  await revokeNonDeveloperSessions(adapter, 1);
  assert.deepEqual(await revokeNonDeveloperSessions(adapter, 1), { users: 3, sessions: 0, alsoMemberOfOtherTenants: 1 });
});

test('wiring: Suspend (active 1 -> 0, not an archive) revokes automatically; the button route is platform-admin only', () => {
  const patch = read('functions/api/platform/tenants/[id].ts');
  assert.match(patch, /if \(current\.active && !next\.active && body\.archived !== true\) \{\s*sessionsRevoked = await revokeNonDeveloperSessions\(env\.DB, tenantId\)/);
  const route = read('functions/api/platform/tenants/[id]/revoke-sessions.ts');
  assert.match(route, /requirePlatformAdmin\(request, env\)/);
  assert.match(route, /revokeNonDeveloperSessions\(env\.DB, tenantId\)/);
  const page = read('src/pages/PlatformTenantsPage.tsx');
  assert.match(page, /Log everyone out/);
  assert.match(page, /window\.confirm\(\s*`Log everyone out of/);
});

// ---------- billing ----------
test('plans: Pack includes the Media Box (consent required), Pilot\'s App does not; price ids come from env', () => {
  assert.deepEqual([...PLANS_WITH_MEDIA_BOX], ['pack']);
  assert.equal(priceIdForPlan('pack', { STRIPE_PRICE_PACK: 'p1', STRIPE_PRICE_PILOT_APP: 'p2' }), 'p1');
  assert.equal(priceIdForPlan('pilotApp', { STRIPE_PRICE_PACK: 'p1', STRIPE_PRICE_PILOT_APP: 'p2' }), 'p2');
  assert.equal(isStripeFailure({ error: 'x' }), true);
  assert.equal(isStripeFailure({ id: 'cs_1', url: 'u' }), false);
});

test('billing routes: owner/admin only, tenant from the session, consent re-checked, no key in responses', () => {
  for (const f of ['status', 'checkout', 'portal']) {
    const src = read(`functions/api/tenant/billing/${f}.ts`);
    assert.match(src, /requireOwner\(request, env\)/, f);
    assert.ok(!/request\.json\(\)/.test(src.replace(/\/\/.*$/gm, '')), `${f}: tenant/plan never read from the request body`);
    assert.ok(!/STRIPE_SECRET_KEY/.test(src), `${f}: no direct key use`);
  }
  const checkout = read('functions/api/tenant/billing/checkout.ts');
  assert.match(checkout, /terms_required/);
  assert.match(checkout, /media_box_consent_required/);
  assert.match(checkout, /already_subscribed/);
  assert.match(checkout, /const origin = new URL\(request\.url\)\.origin/);
  const portal = read('functions/api/tenant/billing/portal.ts');
  assert.match(portal, /no_customer/);
  assert.match(read('functions/api/_utils/stripeApi.ts'), /\/v1\/billing_portal\/sessions/);
});

test('payment never resumes a tenant: no billing code writes tenants.active; webhook rule unchanged', () => {
  for (const f of ['functions/api/tenant/billing/status.ts', 'functions/api/tenant/billing/checkout.ts', 'functions/api/tenant/billing/portal.ts', 'functions/api/_utils/billingContext.ts', 'functions/api/_utils/stripeApi.ts']) {
    assert.ok(!/UPDATE tenants/i.test(read(f)), f);
  }
  assert.match(read('functions/api/stripe/webhook.ts'), /Never touches tenants\.active/);
  const ctx = read('functions/api/_utils/billingContext.ts');
  assert.match(ctx, /paymentReceived: !t\.active && t\.subscriptionStatus === "active" && !!t\.stripeSubscriptionId/);
});

test('Platform Tenants badge: only a SUSPENDED tenant with an active Stripe subscription', () => {
  const page = read('src/pages/PlatformTenantsPage.tsx');
  assert.match(page, /return !tenant\.active && tenant\.subscriptionStatus === 'active' && !!tenant\.hasStripeSubscription/);
  assert.match(page, /Paid — awaiting Resume/);
  assert.match(read('functions/api/platform/tenants/index.ts'), /\(stripe_subscription_id IS NOT NULL\) AS hasStripeSubscription/);
});

// ---------- client ----------
test('takeover content, links and the "Payment received" state', () => {
  const t = read('src/components/admin/SubscriptionTakeover.tsx');
  assert.match(t, /Your subscription isn't active/);
  assert.match(t, /Activate your subscription to restore your dashboard, media screen and Pilot's App\./);
  assert.match(t, /Payment received — your account will be reactivated shortly\./);
  assert.match(t, /sub\?\.paymentReceived \?/);
  assert.match(t, /mailto:support@airfieldcentral\.com/);
  for (const label of ['Billing', 'My Account', 'Contact support', 'Log out']) assert.ok(t.includes(label), label);
  assert.match(t, /findPricingPlan/);
  assert.match(t, /formatGBP\(plan\.priceGBP\)\}\/month/);
  const a = read('src/components/admin/ActivateSubscription.tsx');
  assert.match(a, /TERMS_ACCEPT_URL/);
  assert.match(a, /MEDIA_BOX_CONSENT_ACCEPT_URL/);
  assert.match(a, /\/api\/tenant\/billing\/checkout/);
});

test('central fetch guard: only same-origin /api/tenant/*, never alters the response, 401 and "Subscription not active" events', () => {
  const g = read('src/lib/adminFetchGuard.ts');
  assert.match(g, /path\.startsWith\('\/api\/tenant\/'\)/);
  assert.match(g, /response\.status === 401/);
  assert.match(g, /response\.clone\(\)\.json\(\)/);
  assert.match(g, /return response/);
  assert.match(g, /installCount === 0 && originalFetch/);
});

test('billing page + sidebar entry are owner/admin only and reachable while locked', () => {
  assert.match(read('src/App.tsx'), /path="\/billing"[\s\S]*requireRole=\{\['owner', 'admin'\]\}[\s\S]*<BillingPage \/>/);
  assert.match(read('src/components/admin/sidebarConfig.ts'), /\{ to: '\/billing', label: 'Billing', allowedRoles: \['owner', 'admin'\] \}/);
  const b = read('src/pages/BillingPage.tsx');
  for (const text of ['Update card / manage billing', 'Recent invoices', 'Next payment']) assert.ok(b.includes(text), text);
});
