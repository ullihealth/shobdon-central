# Shobdon Central — Decisions Log

Standing record of architectural/business decisions already made. Don't re-litigate these without a new reason — link back here instead.

---

## 1. Umbrella media brand: separate infrastructure, not shared

**Decision:** If a broader venue-dashboard brand (cafés, hairdressers, salons etc.) is built on top of the same engine, it must run on its own Cloudflare account (or at minimum its own project, database, R2 bucket, and API tokens), its own domain, and its own logins — never plugged into AirfieldCentral's live database or account.

**Why:** AirfieldCentral needs to remain independently sellable. If the two products share one database and one Cloudflare account, handing over either one means also handing over (or exposing) access to the other — a buyer's developer would need credentials touching infrastructure that also runs your other product. That's not a cleanly sellable asset.

**What this rules out:** "piggyback" (same engine, new domain added to the same account) and "shared-core-with-brand-shells" (one codebase, modules toggled per brand) were both considered and rejected for this reason, even though they'd be faster to build.

**What this means in practice:** treat a future media brand as "one engine, copied twice, evolving separately from now on" — clone the current codebase as a starting template, then cut the cord completely. The only ongoing connection is that you personally know both codebases and can port improvements across by hand if you choose to.

**Status:** Decided, not yet built. No media-brand infrastructure exists yet — this is the blueprint for when it does.

---

## 2. AirfieldCentral stays outside any umbrella brand

**Decision:** Even if an umbrella media brand is created, AirfieldCentral does not fall under it.

**Why:** AirfieldCentral is the only vertical with a physical capture agent (ATC PC2, WeatherLink, five-minute site visits) — a genuinely different operational surface, not just a branding difference. Keeping it separate avoids forcing an artificial uniformity across products that don't actually work the same way operationally.

**Status:** Decided, currently the case by default (no umbrella brand exists yet to fall under).

---

## 3. Pages project cannot be renamed — don't attempt it

**Decision:** The Cloudflare Pages project `shobdon-central` will not be renamed. Confirmed directly against Cloudflare's own "Known issues" documentation: `*.pages.dev` subdomains cannot be changed — the only path is delete-and-recreate. The Update Project API technically accepts a `name` field but does not perform a real rename in practice (corroborated by other users' broken deployments after trying it).

**Full inventory of "shobdon"-named resources and their renameability**, for reference:

| Resource | Name | Renameable? |
|---|---|---|
| Pages project | `shobdon-central` | No — confirmed |
| D1 database | `shobdon-central` | No update method exposed |
| R2 bucket | `shobdon-central-media` | No — R2 names are immutable, like S3 |
| KV namespace | `shobdon-central-weather-cache` | Yes |
| KV namespace | `shobdon-central-captures` | Yes |
| Worker script | `shobdon-central-capture` | Likely yes (Workers API added rename support Sept 2025) |
| `package.json` name field | `shobdon-central-conn-test` | Trivial, cosmetic, not a live identifier |
| Frontend localStorage keys | `shobdon-central.*` | Browser-local only, invisible to anyone |

**Why not act on the renameable ones anyway:** the only place "Shobdon" is actually visible to an outside technical reviewer (a future buyer or investor) is the Pages project itself — the one thing that's stuck. Everything else renameable is invisible outside the codebase, so renaming it would be cosmetic tidying with no real payoff.

**When to revisit:** only as a deliberate project alongside an actual sale, fundraise, or rebrand push — not proactively. At that point, delete-and-recreate is the only path, and it requires re-linking custom domains, DNS, and GitHub integration.

**In the meantime:** the codebase, task descriptions, and prompts should already treat Shobdon as tenant #1 among many, not as the basis everything else hangs off — the domain (`airfieldcentral.com`) and the tenant-based architecture already reflect this; only internal plumbing (the Pages project name) doesn't.

---

## 4. Pages → Workers migration: code migrated, domain cutover paused ~~— now superseded, see 2026-07-27 addendum~~

**Addendum — 2026-07-27:** everything below this line describes the state as of when this decision was written, and is now out of date for the "domain cutover paused" part specifically. `shobdon.airfieldcentral.com` (and `demo`/`newcustomer`) are **no longer served by Pages** — the wildcard Worker route added by `Shobdon-Central-Wildcard-DNS-Migration-Plan.md` turned out to intercept them too, contrary to that plan's own "exact match wins" assumption. Full writeup, evidence, and best-available explanation of the mechanism: see that doc's "Update — 2026-07-27" section. Short version: nobody deliberately cut Shobdon over — it happened as an unplanned side effect of Step 3 (the wildcard DNS record) going live, went unnoticed because the Worker's build happened to match what Pages was serving at that exact moment, and only surfaced later when a Pages-only deploy predictably diverged from the still-stale Worker. **This was not a repeat of the outage described below** — no Custom Domain claim was moved, removed, or got stuck; Pages still lists all three as attached Custom Domains, they're just not what's actually answering requests. The rest of this decision (why the cutover was being deliberately deferred, the outage history, the root cause) is still accurate as history and as the reason nobody should manually force a Custom Domain move — read it for that context. Just don't read "domain cutover paused" as describing the current state anymore.

**Decision (as originally written, now historical):** The application code migration from Cloudflare Pages to a Cloudflare Worker is complete and tested clean, but the live domain cutover is deliberately paused. `shobdon.airfieldcentral.com` remains served by the Pages project (`shobdon-central`), not the new Worker (`airfield-central`).

**Why paused:** attempting to move `shobdon.airfieldcentral.com` from Pages to the Worker caused a real production outage. Cloudflare requires removing the domain from Pages before it can be added to the Worker, and doing this back-to-back left the hostname in a stuck, orphaned claim state — visible in neither the Pages panel, the Worker's Domains & Routes panel, nor raw DNS records. Recovery required a Cloudflare support ticket; the site was down for a period before it was restored (back onto Pages, not the Worker).

**Root cause — confirmed by Cloudflare support** (ticket resolved, no longer open): a known timing window in Custom Domain claim propagation. Removing a hostname from one resource releases its internal claim record asynchronously, not instantly; attaching it to a different resource before that finishes propagating causes both sides to reject it, and it clears on its own within minutes to a couple of hours. Cloudflare's own guidance: wait a few minutes between removing a Custom Domain from one resource and adding it to another. See Runbook 2 for the full confirmed sequence.

**What's confirmed safe regardless of this pause (as originally written — see caveat below):**
- The new Worker (`airfield-central`) exists, is fully tested against a preview URL, and has zero custom domains attached — inert and safe.
- Both `airfieldcentral.com` and `demo.airfieldcentral.com` were confirmed untouched throughout the incident.
- ~~All application-level feature work (billing, admin pages, etc.) continues normally through the existing Pages auto-deploy pipeline — this pause only affects the domain-cutover step, not day-to-day shipping.~~ **No longer true as of the 2026-07-27 addendum above.** Since the wildcard Worker route now intercepts every tenant subdomain including Shobdon's, a plain `git push` (Pages-only) no longer reaches any live tenant by itself — day-to-day shipping now requires a manual `wrangler pages functions build` + `wrangler deploy --config wrangler.worker.toml` on top of the normal push, or changes silently never go live. (This gap is being closed with a GitHub Actions workflow — see `Shobdon-Central-Engineering-Changelog.md` — but until that's confirmed working, treat every deploy as two steps, not one.)

**When to revisit:** ~~only when Custom Hostnames or Workers-for-Platforms functionality is actually needed for real multi-tenant onboarding (i.e., when a genuine second/third tenant needs true operational readiness, not before).~~ Moot — the cutover already happened, unplanned, per the addendum above. If a *deliberate* Custom Domain move (Shobdon's claim from Pages to the Worker, cleanly, with the claim itself transferred rather than just pre-empted by a route) is ever wanted for its own sake, move one domain at a time, wait several minutes between removing from Pages and adding to the Worker (rather than back-to-back), and see the Runbooks doc for the full sequence and what to check at each step.

**Cloudflare support ticket:** resolved. Cloudflare responded and confirmed the root cause (see above) — no longer something to check before the next attempt.

---

## 5. Weather ingestion architecture: KV-based capture stays authoritative for now

**Decision:** Shobdon's real-time weather display continues to run on the original pipeline — PC2 → `shobdon-central-capture` Worker → KV namespace (`shobdon-central-weather-cache`) — not the newer D1-based `weather_observations`/`latest_conditions` ingestion pipeline that was built alongside the multi-tenant API-key work.

**Why:** the newer D1 ingestion pipeline and its `ingested` provider were built for the multi-tenant case (tenants without a physical PC2, submitting via API key), but nothing in Shobdon's existing dashboard was ever wired to read from it. Changing Shobdon's actual data source was out of scope for that work, so it was deliberately left on its original, already-proven path.

**Practical implication:** if you ever see a stale/old reading from `/api/public/weather-latest`, check whether you're looking at the D1 pipeline (used by tenants without a local capture agent) rather than Shobdon's real KV-backed feed before assuming something's broken — this already caused one false alarm.

---

## 6. Access control for platform-level admin: reuse `user.developer`, not a new concept

**Decision:** The `/platform/tenants` admin page (visible only to you, across all tenants) is gated by the existing `user.developer` flag via a new `requirePlatformAdmin` check, deliberately independent of org membership, `?org=` query params, or the org-switcher cookie.

**Why:** an earlier version reused the existing `requireDeveloper` helper, which depended on `requireTenant` resolving org membership first — meaning a real developer account could get a spurious 403 just from an unrelated `?org=` value. The fix decouples platform-admin access from tenant/org context entirely, since platform admin should never depend on which tenant you happen to be scoped to.

**Status:** Built, tested (full 401/403/200 matrix including edge cases), deployed.
