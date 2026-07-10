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
