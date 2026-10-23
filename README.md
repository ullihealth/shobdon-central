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
