# Shobdon Central — Engineering Changelog

Completed, deployed, and verified work — pulled out of the live threads so the active conversations only carry genuinely open work. Roughly chronological.

---

## Responsive dashboard series (five commits, TV Dashboard Design thread)

A sequential bug-fix series, each addressing a distinct root cause found by direct measurement rather than guesswork:

- **`7e7852c` / `51a4bd6`** — fixed content-driven auto-height stat rows (clipping) and missing min-height (collapse/overlap) in LeftInfoPanel and RightInfoPanel via `grid-template-rows: repeat(N, minmax(<floor>, 1fr))` and `clamp()`-based safe-area padding.
- **`bc54c0c`** — compass component was sized via a `vh`-anchored `clamp()` tied to viewport height rather than its actual flex cell, causing it to dominate its column on different aspect ratios. Fixed to fill its container (`aspect-square`, `h-full`/`w-full`). Also added the first global fluid type scale (`html { font-size: clamp(12px, 1.5vmin, 20px) }`) — previously no root font-size rule existed at all, so text never scaled with viewport.
- **`b75c77e`** — three distinct issues: (1) a CSS grid using percentage tracks with a fixed-px gap doesn't reserve space for the gap, causing the right panel to bleed off-screen — fixed by switching to `fr` units; (2) the Cloud Base chart was fine on its own, but an upstream `max-w-[1920px]` cap on the page (predating this whole series) distorted its container into an extreme shape at 4K — removed the cap; (3) the compass readout list used the global `vmin`-based scale, but its actual available space came from `vh` via the flex chain, causing a unit mismatch that clipped it on short-but-wide screens — given its own local `vh`-based clamp, decoupled from the global scale.
- **`ab7125a`** — the Cloud Base chart's `viewBox` used a fixed aspect ratio picked as "close to the middle of observed resolutions" — not correct by construction, so any card shape outside that range still mismatched. Fixed by tracking the SVG's real rendered box via `ResizeObserver` and computing the `viewBox` to always match exactly. Also gave Weather Summary card labels and values their own local `vh`-based clamps, decoupled from the global scale, so a two-line-wrapped label no longer ate into the value's headroom.
- **Follow-up (unnumbered commit)** — two more Weather Summary fixes: gave parenthetical qualifier text ("(MET OFFICE FORECAST)", "(SHOBDON CALCULATED)") its own smaller, accent-colored sub-label style to free vertical space, and fixed a day/night forecast-icon bug where the 6-hour forecast used the *viewing device's* local clock rather than a fixed timezone — now anchored to a configurable per-tenant IANA timezone (`Europe/London` for Shobdon) rather than hardcoded or client-derived.
- **Scoping correction** — investigated a suspected regression (main card labels shrinking on Mac but not on the TV) and found no actual bug: the label/qualifier styles were already correctly independent, and the observed difference was two unrelated, pre-existing effects (viewport-height-driven `vh` scaling behaving as designed on very different screen sizes, and a legitimate per-tenant theme color override). No code changes needed.

**Verified across a standard resolution matrix** (1920×1080, 3840×2160, 1280×720, 1366×768) plus deliberate stress tests (2560×1080 ultrawide, 1024×1366 portrait-ish, a pathological 1024×500 that caught one genuine edge-case clip before it was ever reported).

**Not done:** PWA/"Add to Home Screen" support for iOS Safari fullscreen — fully drafted as a ready-to-send prompt, never actually sent. Still open, see Outstanding list.

---

## Webcam carousel persistence + appearance editing

**Problem:** the clubhouse webcam (embedded via rtsp.me) required pressing Play again every time the carousel rotated away and back, making unattended operation unsuitable.

**Root cause:** the carousel only mounted the active slide, destroying and recreating the webcam iframe on every rotation — and rtsp.me shows a click-to-play screen on every fresh page load.

**Fix (`8fe5d24`):** changed the carousel to mount all slots simultaneously, toggling visibility via CSS rather than destroying/recreating. The webcam iframe is now never destroyed while the dashboard stays open — one Play click per page load, not per rotation. MP4 slots pause/resume via `useRef`/`useEffect` rather than relying on `autoPlay`, since they're now permanently mounted too.

**Follow-up (`c011c8b`):** enabled zoom/pan/rotate/brightness/banner appearance editing for webcam slots (previously only available for images/MP4), applying CSS transforms directly to the iframe. Fit Mode intentionally excluded for webcam since it has no effect on iframe rendering.

**Standing rule going forward:** do not revert to a destroy/recreate media lifecycle for carousel slots — persistent mounting is now the intentional architecture, and any future webcam changes (e.g. a direct Hikvision/HLS feed) should preserve it.

---

## PC2 self-serve setup + CAPTURE_KEY security fix

**Problem:** getting a new site's capture agent running required manually sending files and walking someone through setup live — doesn't scale, and creates personal liability risk when instructing someone else's on-site staff.

**Fix (`b7a6602`):** added a "PC2 / Weather Capture Setup" section to `/config`, reachable by any owner/admin: download the capture script, download an auto-start installer (registers the script as a proper Windows scheduled task rather than relying on the fragile Startup-folder behavior — see Runbooks), and a printable PDF instruction sheet. Relocated the existing "View Capture Logs" and "Refresh PC2 Now" controls into this section, and fixed a security gap while doing so: those controls previously linked directly to the capture Worker with `CAPTURE_KEY` visible in a plain, copy-pasteable/screenshottable URL. They now route through authenticated server-side proxy endpoints that inject the key server-side, never exposing it in the browser.

**Also fixed in the same pass:** the `/config` page layout, previously a fixed ~900px single column regardless of viewport, now uses a responsive multi-column grid at desktop width.

---

## Multi-tenant weather ingestion + API keys

**Problem/finding:** none of the three existing weather providers (ATC, internet, mock) ever wrote to D1 — building a tenant-facing ingestion API alone would have written data nowhere any dashboard could read.

**Fix:** built a fourth provider (`ingested`) plus a new public read endpoint, closing the gap. Also found and backfilled `tenants.lat`/`lon`, which were `NULL` for both Shobdon and Demo, breaking per-tenant coordinate resolution.

**Security verification (full matrix tested):** valid key on own tenant succeeds; cross-tenant writes are structurally impossible (the ingestion endpoint resolves the tenant solely from the API key, never from request body — not a validated-against case, but an eliminated one); revoked/missing/bogus keys correctly rejected with 401; cross-tenant key revocation attempts correctly return 403 (fixed from an earlier silent-no-op 200).

**Also shipped in this stream of work:**
- Per-tenant storage quota tracking and enforcement (`tenants.storage_quota_bytes`, default 100MB).
- Tenant pause/resume toggle — reused the existing `active` column (previously only gated the cross-tenant directory listing) to gate all public dashboard routes from one change point (`resolveTenantHost.ts`). Verified zero data loss on resume.
- `/platform/tenants` — a genuinely platform-admin-only tenant directory/management page, gated by `user.developer` independent of org context (see Decisions log for why this needed a dedicated access-control helper).

---

## Pages → Workers migration (code complete, cutover paused)

Full `functions/api/` tree (40 files) compiled cleanly into a Workers-compatible script via Cloudflare's documented conversion path, with the new Worker (`airfield-central`) binding to the exact same D1/R2/KV resources — no data migration needed. Key gotcha caught before it caused a problem: Workers doesn't auto-fall-back to `index.html` for unmatched routes the way Pages does, requiring an explicit `not_found_handling = "single-page-application"` setting or every client-side route would 404. Full regression sweep passed on a preview URL before any domain was touched. The domain cutover itself is paused — see Decisions log.

---

## Onboarding UI polish, wildcard-Worker precedence discovery, and Worker-deploy CI

**Onboarding UI polish (`6a76aef`):** bumped body/label text one step up the existing Tailwind scale on the invite subdomain-picker, account-setup, and terms pages; added a confirm-password field + reusable show/hide `PasswordField` component to account setup (blocking submit on mismatch); widened `/onboarding/terms` from a narrow `max-w-3xl` centered column to the full-width `max-w-5xl` pattern used elsewhere. Verified against a real local `wrangler pages dev` + D1 session with Playwright (screenshots, functional checks on the mismatch/toggle behavior) before shipping.

**Discovered while chasing why the fix wasn't showing up live:** despite a clean Pages deploy and (eventually) confirmed cache purges, `gyroplane.airfieldcentral.com` kept serving the old bundle — and so did `shobdon`/`demo`/`newcustomer.airfieldcentral.com`, all four in lockstep. Root cause: the wildcard Workers Route added by the DNS migration plan (`Shobdon-Central-Wildcard-DNS-Migration-Plan.md`) intercepts every tenant subdomain, Shobdon included, contrary to that plan's "exact match wins" assumption at cutover time. The standalone Worker (`airfield-central`) hadn't been redeployed since before the fix was written, so it kept serving stale content indefinitely — no Pages-side cache purge could ever have touched it, since Pages wasn't answering these requests at all. Fixed by rebuilding and redeploying the Worker directly (`wrangler pages functions build` + `wrangler deploy --config wrangler.worker.toml`); confirmed live on all four subdomains afterward via direct bundle-content inspection. Full writeup, evidence, and the corrected architecture: see the Migration Plan doc's "Update — 2026-07-27" section, and the accompanying Decision #4 / Runbook 2 addenda.

**CI follow-up (`.github/workflows/deploy-worker.yml`):** since this exact gap (Pages-only deploy, Worker silently stale) had already bitten this session multiple times before it was understood, added a GitHub Actions workflow that runs the same build+deploy steps for the Worker automatically. Shipped in a deliberately inert state — `workflow_dispatch` only, no `push` trigger yet — pending Jeff adding a `CLOUDFLARE_API_TOKEN` repo secret (Workers Scripts:Edit, scoped to this account/zone only) and a first manual test run confirming it actually redeploys correctly before the automatic-on-push trigger gets enabled.

**CI confirmed working, `push` trigger enabled (2026-07-27):** after the secret was added, triggered a manual `workflow_dispatch` test run (run #1) — all steps (checkout, `npm ci`, `npm run build`, `wrangler pages functions build`, `wrangler deploy --config wrangler.worker.toml`) completed successfully. Verified the actual effect, not just a green checkmark: the Worker's own `wrangler deployments list` showed a new deployment timestamped to match the run, and `gyroplane.airfieldcentral.com` (both `/` and `/onboarding/terms`) kept serving 200 with the correct bundle afterward. `on: push: branches: [main]` uncommented in the workflow immediately after — every push to `main` now redeploys both Pages (its own existing auto-deploy, unchanged) and the standalone Worker.
