# Shobdon Central — Wildcard DNS / Custom-Domain Migration Plan

**Status:** Proposed, not started. Planning only — no code, DNS, or Cloudflare dashboard changes have been made as part of this document. Written up per Jeff's request after the Tom Galloway/Gyroplane Train investigation surfaced that no new tenant's subdomain is reachable without a manual, per-tenant Cloudflare step.

**Do not execute this without a deliberate go-ahead and a scheduled window** — see Decision #4 and Runbook 2 below for why a domain-level Cloudflare change here has already gone wrong once.

---

## Why this exists

Every tenant's `subdomain` column (`tenants.subdomain`, e.g. `gyroplane-train.airfieldcentral.com`) is set correctly the moment the tenant is created — but nothing makes that hostname actually resolve. Confirmed live:

| Host | Result |
|---|---|
| `shobdon.airfieldcentral.com` | 200 (manually added Pages Custom Domain) |
| `demo.airfieldcentral.com` | 200 (manually added Pages Custom Domain) |
| `newcustomer.airfieldcentral.com` | 200 (manually added Pages Custom Domain) |
| `airfieldcentral.com` (bare) | 200 (marketing site) |
| a random new-tenant-style subdomain | connection failure — no DNS record at all |

Three manually-added Custom Domains is the entire current mechanism. Every tenant onboarded since (Gyroplane Train, and every future one) gets nothing, silently, until someone remembers to add it by hand.

**Confirmed against Cloudflare's current docs (checked directly, not assumed from memory):**
- Cloudflare **Pages** does not support a wildcard Custom Domain (`*.airfieldcentral.com`) — still a standing product limitation.
- Cloudflare **Workers Custom Domains** (the friendly, DNS-managed-for-you UI) also explicitly reject wildcard hostnames.
- Cloudflare **Workers Routes** (the older, more flexible mechanism — `pattern = "*.airfieldcentral.com/*"` in `wrangler.toml`) **do** support wildcard hostnames natively, on any plan, and this is the standard documented way to catch every subdomain under a zone with one rule.

So the only real path to "every tenant subdomain just works, no manual step" is a wildcard **Route** on a **Worker** — not Pages, and not a Custom Domain.

---

## What's already true, and why this is lower-risk than it sounds

Per **Decision #4** (`Shobdon-Central-Decisions.md`) and **Runbook 2** (`Shobdon-Central-Operational-Runbooks.md`):

- The Pages → Workers **code** migration is already done. The `airfield-central` Worker exists, is tested clean against a preview URL, and currently has **zero** custom domains or routes attached — inert.
- The prior outage was specifically about moving `shobdon.airfieldcentral.com`'s **Custom Domain claim** from Pages to the Worker for the *same* hostname — Cloudflare's "you can't attach a Custom Domain where a conflicting DNS record already exists" rule, then a claim-propagation timing issue that left the hostname's claim stuck in limbo, invisible in every dashboard panel, resolved only via a support ticket.
- **This plan never touches that mechanism, and never touches Shobdon's existing claim.** A wildcard Route is an additive rule on a hostname pattern that currently has **no** existing Custom Domain or DNS record at all (every subdomain except the three above). There's no "remove from Pages, re-add to Worker" step for that pattern — nothing to reconcile, nothing to get stuck. Cloudflare's own precedence rule (exact match beats wildcard) means Shobdon/demo/newcustomer's existing explicit Pages Custom Domains are simply never evaluated against the wildcard route — this needs to be verified live at Step 4, not just trusted, but it is not the same failure mode that caused the outage.

Still treating this with the same caution as Runbook 2 throughout — a DNS-zone-level change on a domain the whole site depends on is not something to rush, tested-safe theory or not.

**Update — the prior outage's root cause is now confirmed** (Cloudflare support responded, ticket resolved; see Decision #4 and Runbook 2 for the full writeup): a known timing window in Custom Domain claim propagation — removing a hostname from one resource releases its internal claim asynchronously, and attaching it to a different resource before that finishes propagating causes both sides to reject it. It clears on its own within minutes to a couple of hours; Cloudflare's own guidance is to wait a few minutes between removing a Custom Domain from one resource and adding it to another.

**This doesn't directly apply to Steps 1–4 below** — none of them remove or re-add a Custom Domain claim; the wildcard Route targets hostnames with no existing claim to propagate. It matters as a documented gotcha for a *different*, later, **not-currently-planned** step: if this project ever does move Shobdon's own `shobdon.airfieldcentral.com` Custom Domain claim from Pages to the Worker (e.g. as a follow-on once the Worker is proven in production via the wildcard tenants first), that step must build in the confirmed wait — remove, wait a few minutes minimum (up to a couple of hours if the add step fails), then add — never back-to-back. Follow Runbook 2's sequence exactly when that day comes; it now reflects this confirmed guidance.

---

## Ordered steps

### Step 1 — [CODE] Add the wildcard route to the Worker config

Add to `wrangler.worker.toml`:

```toml
[[routes]]
pattern = "*.airfieldcentral.com/*"
zone_name = "airfieldcentral.com"
```

This alone changes nothing live — a route with no matching DNS traffic reaching Cloudflare's edge for that pattern does nothing. Safe to write and even deploy the Worker with this config before any DNS exists; it simply won't fire yet.

**Rollback:** delete the `[[routes]]` block, redeploy. No live traffic was ever affected, since Step 2 hasn't happened yet.

### Step 2 — [CODE] Deploy the Worker with the new route

```
wrangler deploy --config wrangler.worker.toml
```

Still inert without Step 3 — the Worker is reachable at its `workers.dev` URL regardless (already true today), but the wildcard pattern has no DNS to match against yet.

**Rollback:** redeploy the previous version (`wrangler rollback --config wrangler.worker.toml`, or redeploy from the prior commit). The `workers.dev` URL and all three existing Pages Custom Domains are untouched by this step either way.

### Step 3 — [ACCOUNT, Jeff only] Add the wildcard DNS record

In the Cloudflare dashboard, DNS settings for the `airfieldcentral.com` zone: add a **proxied** (orange-cloud) record for `*.airfieldcentral.com`. Content can be a placeholder (e.g. a CNAME to `airfieldcentral.com` itself) — Workers Routes intercept the request at Cloudflare's edge before any origin is contacted, so the record's actual target is irrelevant; its only job is getting the hostname to resolve to Cloudflare at all.

**This is the step that makes every unprovisioned tenant subdomain start resolving, all at once.** Before this step, nothing changes for anyone. After it, the wildcard Route (Step 1–2) starts actually firing for every subdomain that doesn't already have its own explicit DNS record.

**Rollback:** delete the DNS record. Every subdomain that started working reverts instantly to today's connection-failure state. Shobdon/demo/newcustomer are unaffected either way (their own explicit records take precedence and were never touched).

### Step 4 — [CUTOVER, verify before declaring done] Confirm exact-match precedence holds

Before treating this as finished, explicitly verify — don't assume — that Shobdon, demo, and newcustomer still resolve to the **Pages** project (their existing Custom Domain), not the new Worker, now that a wildcard Route theoretically also matches their hostnames:

```
dig @1.1.1.1 +short shobdon.airfieldcentral.com
curl -sI https://shobdon.airfieldcentral.com/ | head -5
curl -sI https://demo.airfieldcentral.com/ | head -5
curl -sI https://newcustomer.airfieldcentral.com/ | head -5
```

Same private/incognito-window caution as Runbook 2 applies to any browser check — DNS and browser caches can show a stale "it works" result that isn't actually live.

Then confirm a **brand-new, previously-unreachable** tenant subdomain now resolves and serves the Worker's response (a fresh test tenant, or a `curl` against a made-up `*.airfieldcentral.com` hostname that has no tenant at all — should get a clean 404 from the Worker/`resolveTenantHost.ts`, not a connection failure).

**If Shobdon/demo/newcustomer unexpectedly started routing to the Worker instead of Pages:** this would mean the exact-match-over-wildcard assumption was wrong for this specific setup — stop immediately and remove the wildcard DNS record from Step 3 (fastest full rollback, reverts everyone to the pre-migration state) rather than trying to debug live.

---

## Maintenance window

- **Timing:** low-traffic period for Shobdon specifically — not mid-flying-session, matching Runbook 2's own guidance. Shobdon is the only tenant with real day-to-day operational reliance on its dashboard today.
- **Monitor during cutover:** keep a terminal open polling `curl -sI https://shobdon.airfieldcentral.com/` (or the actual dashboard in a private window) continuously through Step 3–4 — the one prior incident's failure mode was silent (no dashboard error, just a hostname stuck in limbo), so active polling catches a regression faster than waiting for it to be reported.
- **Order of operations on the day:** Steps 1–2 (code) can happen well in advance, any time, zero risk. Do Step 3 (the actual DNS change) as its own isolated action, then immediately run Step 4's full verification before doing anything else or considering the change complete.
- **Confirm success before closing this out:** all of Step 4's checks pass, AND a real freshly-onboarded tenant's subdomain (Gyroplane Train's actual one, if still around, or a new disposable test tenant) is confirmed reachable end-to-end — not just DNS resolving, but the actual dashboard rendering, matching the standard this whole investigation started from.

---

## Existing tenants — explicitly confirmed unaffected

- **Shobdon:** keeps its existing Pages Custom Domain untouched throughout. Exact match wins over wildcard (Cloudflare's documented precedence rule) — verified live at Step 4, not just assumed.
- **Demo, newcustomer:** same as Shobdon — both already have their own explicit Custom Domains today (confirmed live, 200 each), unaffected by an additive wildcard rule that only ever applies to hostnames with no more specific match.
- **Every future tenant** (Gyroplane Train included): purely additive — the first tenant to actually benefit from this without a manual step.

---

## Resolved since this plan was first written

Cloudflare support has since responded to the original outage's ticket and confirmed the root cause (a claim-propagation timing window — see the "Update" note above, Decision #4, and Runbook 2). The ticket is closed. This doesn't change Steps 1–4 of this plan (they never touch a Custom Domain claim), but it's now settled, documented guidance for the separate, not-currently-planned step of ever moving Shobdon's own Custom Domain to the Worker.
