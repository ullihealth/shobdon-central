# Shobdon Central — Weather Connectivity Test

Purpose
- This is a technical proof-of-concept to determine whether a browser application hosted on Cloudflare Pages can directly retrieve the weather page at:

  http://192.168.2.1/disp/adisp.php

Important constraints
- Single-page React application (no backend, no proxy, no Cloudflare Workers).
- The request is performed directly from the browser using the Fetch API.

How to install

```bash
npm install
```

Run locally

```bash
npm run dev
```

Build

```bash
npm run build
```

Deploy
- Push this repository to GitHub and use Cloudflare Pages to deploy the built static site. Cloudflare Pages hosts the built output from `npm run build` — no additional configuration required for a plain SPA.

Meaning of results
- 🟢 SUCCESS — The browser successfully retrieved the page (HTTP status and body visible).
- 🟠 POSSIBLE CORS RESTRICTION — The normal fetch failed but a diagnostic `no-cors` probe indicates the host is reachable. This usually means the server responded but CORS policy prevented access to the response in the browser.
- 🔴 NETWORK FAILURE — The browser could not reach the host (DNS, routing, or local network issue).

What to do next
- If SUCCESS: proceed — the production app can read the existing weather source directly (subject to security review).
- If POSSIBLE CORS RESTRICTION: update the local weather server to send appropriate CORS headers (e.g., `Access-Control-Allow-Origin: *` or restrict to your Pages domain), or consider a secure bridge when necessary.
- If NETWORK FAILURE: confirm Cloudflare-hosted clients can reach the 192.168.2.1 address (typically not routable from the public internet). A bridge or relay inside the local network will be required if the host is not publicly reachable.

Notes
- This project is intentionally minimal and diagnostic. It does not attempt to bypass browser security; it only performs a short `no-cors` probe as a diagnostic check to help differentiate CORS vs network failures.

Admin accounts and password resets
- There is no self-service "forgot password" for any account, including the owner. BetterAuth's built-in reset flow requires an `emailAndPassword.sendResetPassword` callback that actually sends an email, and this project has no email-sending infrastructure configured (confirmed by inspecting `node_modules/better-auth/dist/api/routes/password.mjs` - the route throws `RESET_PASSWORD_DISABLED` without one).
- For admin/atc accounts: the tenant owner can generate a new temporary password directly from `/members` ("Reset password" on that member's row) - no email involved.
- For an owner's own forgotten password: there's no self-service path yet. Contact the developer (jeffthompson@europe.com) for a manual reset directly against the D1 database, the same way the original owner account was seeded.


Pilot's App updates (how a phone gets new code)
- The Pilot's App (/pilot) is a service-worker PWA that phones leave open for days. DECISION (supersedes the old "the pilot's tap is the only way the app reloads"): a developer can force an update, and a release forces one automatically.
- Detecting a release: scripts/stamp-pilot-sw.mjs appends the latest RELEASED version label to the built pilot-sw.js, so its bytes change only when a new version is released in Developer Features (ordinary deploys leave it identical). An open app asks the browser to re-check pilot-sw.js on its 60-second tick, when it returns to the foreground, on pull-to-refresh, on open and every 6 hours (rate-limited to once per 30 s).
- When a new version is waiting: if AUTO_FORCE_UPDATE_ON_RELEASE (src/config/pilotUpdatePolicy.ts - the single switch) is true, the app shows "Updating to the latest version…", activates the new worker and reloads itself (at most once per 10 minutes, so it can never loop). If the switch is false, or the 10-minute limit applies, it shows the large "A new version of the app is available" box with one "Update now" button (no dismiss) over a blurred backdrop; tapping it activates and reloads.
- Developer "Force Pilot App update": Platform -> Tenants, per tenant and for all tenants (functions/api/platform/force-pilot-update.ts, requirePlatformAdmin). It reuses the dashboards' refresh-flag mechanism (capture Worker KV, non-consuming) under the key pilot:<slug>, separate from "Refresh displays". An open app (on this code) reads the flag on its 60-second tick and on return to the foreground; the first read is a baseline, a later NEW timestamp shows "Updating to the latest version…", updates the service worker, activates any waiting one and reloads - once per request (also remembered in localStorage).
- Safety: offline or any failed check never reloads and never blanks the app (src/utils/pilotForceUpdate.ts, tests in scripts/pilot-force-update.test.mjs). Apps still running code from before this change keep the old thin "tap to refresh" strip until they update once; the box and force only apply after that.
- The Mobile Pilot View lock re-check (PilotViewPage.tsx) rides on the same 60-second tick.

Suspended tenants (Platform -> Tenants -> Suspend)
- Suspend sets tenants.active = 0: the public dashboard/data go offline (resolveTenantHost.ts) AND the tenant's own non-developer users are limited to My Account and paying. DECISION (supersedes "a paused tenant's back-office stays reachable"). Archive is stronger still (403 for everyone).
- Enforced SERVER-SIDE in functions/api/_utils/tenantAuth.ts requireTenant, which every /api/tenant/* route goes through: 403 {error: "Subscription not active"} on everything except GET /api/tenant/me, POST /api/tenant/terms/accept, POST /api/tenant/media-box-consent/accept (and /api/stripe/checkout). My Account (/api/auth/*) and the /activate/<token> link flow (/api/public/activation/*) never go through requireTenant, so they keep working. Developers / platform admins are unaffected. Admin pages already open on old code simply start getting 403s.
- Client (AdminLayout.tsx, AdminSidebar.tsx): banner "Subscription not active. Your account is on hold - please activate your subscription to restore access.", every sidebar item greyed out except My Account (and Log out), and a direct link to a locked page shows the message instead of the page.
- Payment does NOT resume the tenant: the Stripe webhook never touches tenants.active. Resume stays a manual developer action.

Billing, "Log everyone out" and the "subscription not active" page
- Suspend (Platform -> Tenants) now ALSO signs out every NON-developer member of the tenant (revokes their BetterAuth `session` rows; developers/platform admins and other tenants' users are never touched). The same action is available on its own as "Log everyone out" per tenant. Tabs already open - even on old code - go to the login page the next time they re-check their session (window focus / tab visible); after logging in a suspended tenant's user sees ONE full page ("Your subscription isn't active", src/components/admin/SubscriptionTakeover.tsx). New code also switches to it the moment ANY /api/tenant/* call answers 403 "Subscription not active" (lib/adminFetchGuard.ts) and goes to the login page on any 401. The server-side lock and its allow-list live in functions/api/_utils/tenantAuth.ts.
- "Activate subscription" needs no activation link: owner/admin accept the Customer Terms (and, for the Pack, the Media Box loan terms) inline, then POST /api/tenant/billing/checkout starts a Stripe Checkout Session for the tenant's plan (latest activation link's plan, else Pack when the Reception Dashboard is enabled, else Pilot's App). Payment goes through the existing webhook and NEVER resumes the tenant: once Stripe reports it paid, the page says "Payment received - your account will be reactivated shortly" and Platform Tenants shows a "Paid - awaiting Resume" badge until a developer presses Resume.
- Billing page (/billing, owner/admin): plan, status, next payment date, recent invoices, and "Update card / manage billing" (POST /api/tenant/billing/portal -> Stripe Customer Portal). One-time Stripe setup, in the TEST dashboard and again in LIVE (Settings -> Billing -> Customer portal): turn the portal ON; allow customers to update payment methods and view invoice history; choose whether they may cancel subscriptions; set the business information / terms / privacy links; save. No keys live in code - STRIPE_SECRET_KEY is a Cloudflare Pages secret and the price ids are wrangler.toml [vars].
- Local testing without Stripe: `node scripts/stripe-local-stub.mjs` (port 8799, matching .dev.vars' STRIPE_API_BASE_URL) stands in for Stripe's API and hosted pages and fires a signed checkout.session.completed at the local webhook.
