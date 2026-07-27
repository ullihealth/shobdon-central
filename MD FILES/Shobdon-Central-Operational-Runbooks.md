# Shobdon Central — Operational Runbooks

Procedures worth following rather than re-deriving from scratch under pressure. Both of these were learned the hard way once already.

---

## Runbook 1: Diagnosing a dead PC2 weather feed

**Symptom:** the dashboard's weather data stops updating / the ATC feed goes silent.

**Step 1 — Check whether Cloudflare has actually stopped receiving data.**
Fetch the capture Worker's own status page/endpoint (`https://shobdon-central-capture.<account>.workers.dev/`) and check the `Received:` timestamp on the latest capture. If Cloudflare is still receiving fresh captures, the problem is downstream of Cloudflare (a dashboard rendering issue) — a different runbook entirely. If the timestamp is stale, the problem is upstream, on PC2's side.

**Step 2 — Rule out anything on the app side.**
Check whether the capture Worker's code was modified recently (its own deploy history) and whether the app's D1 schema has any weather-related tables at all. In this architecture, weather data never touches D1 — it's written exclusively to a separate KV namespace by a completely independent Worker. A routine dashboard-appearance deploy (webcam changes, layout tweaks, etc.) has no code path that can touch the capture pipeline. If the last capture timestamp lines up with a known event on PC2's end (e.g., the machine being switched off), that's a strong signal the fault is there, not in anything you shipped.

**Step 3 — Rule out a Cloudflare-side quota/token issue.**
Check for any billing/quota email from Cloudflare. If none exists and the Worker/KV both show healthy status with no errors, it's very unlikely to be a Cloudflare-side failure.

**Step 4 — Diagnose PC2 itself, remotely where possible.**
Common cause: the capture script is a raw `.ps1` file placed directly in the Windows Startup folder. **Windows does not execute `.ps1` files on login by default** — it associates them with "Edit," not "Run," as a deliberate security default. So after any restart, the capture loop silently never starts, even though "the file is in the Startup folder." This fits the pattern of "restarted a couple of times, still nothing" — a real crash or network failure usually shows up sooner or intermittently; total silence across multiple restarts points to "never actually ran."

**Step 5 — Fix without requiring PC2 access or Windows expertise.**
Don't ask a non-technical on-site volunteer to manually create a Startup shortcut with a specific PowerShell command line — it's fragile and easy to get wrong under phone guidance. Instead, use a proper installer:
- `capture-weathercentral.ps1` — the actual capture script (reads the local weather station page, POSTs to the Cloudflare Worker on an interval).
- `install-weather-capture-autostart.bat` — registers the capture script as a real scheduled task (`schtasks /Create ... /SC ONLOGON`) that fires on every login and starts it immediately too, rather than relying on the fragile Startup-folder behavior.

Both files, plus printable instructions, should be available as a self-serve download from `/config` (the "PC2 / Weather Capture Setup" section) — not sent ad hoc by you personally. This matters both practically (you may not have Windows expertise or want to be the one "instructing the expert" and risk being blamed if something goes wrong) and for future scalability (a new airfield onboarding themselves shouldn't need a live call with you).

**Step 6 — Verify the fix.**
Confirm via the Capture Logs link that a new entry appears within a minute of running the installer.

---

## Runbook 2: Moving a Cloudflare Custom Domain between resources (Pages ↔ Worker)

**Current-state note (2026-07-27) — read before assuming Shobdon is still on Pages:** the procedure below is written for a *deliberate* Custom Domain move that nobody has actually needed to perform since the incident it describes — Shobdon's Pages Custom Domain claim was never touched again. But `shobdon.airfieldcentral.com`, `demo.airfieldcentral.com`, and `newcustomer.airfieldcentral.com` are, as of the wildcard-Worker-route rollout, all **actually served by the Worker anyway** — a wildcard Workers Route turned out to intercept them ahead of their still-intact Pages Custom Domain claims, contrary to what `Shobdon-Central-Wildcard-DNS-Migration-Plan.md` assumed at the time. Full evidence and explanation in that doc's "Update — 2026-07-27" section, cross-referenced from Decision #4. **Practical effect on this runbook:** the specific failure mode described below (orphaned claim, support ticket) is still accurate if you ever do a manual Custom Domain move — but don't use "which resource currently serves this hostname" as a signal for whether a move has happened, since that's now decoupled from the Custom Domain claim entirely. Check actual served content (bundle hash, `cf-cache-status`) to know what's really serving a hostname, not which panel lists the Custom Domain.

**Why this matters:** a previous attempt to move `shobdon.airfieldcentral.com` from the Pages project to the new Worker caused a real production outage, requiring a Cloudflare support ticket to fully resolve. Follow this sequence deliberately next time, rather than repeating the same steps back-to-back.

**What actually happened, for context:**
1. Attempting to add the domain directly to the Worker while it was still attached to Pages failed with "No zones match" — caused by Cloudflare's rule that you cannot attach a Custom Domain to a hostname that already has a conflicting DNS record, and Pages' own managed record for that hostname was still in place.
2. Removing the domain from Pages first, then immediately trying to add it to the Worker, failed a second time with no clear error — most likely an internal reconciliation lag between a hostname being released by one resource and being claimable by another.
3. Attempting to restore it back to Pages then failed with "already associated with an existing project" — the hostname was stuck in an orphaned internal claim, invisible in the Pages panel, the Worker's Domains & Routes panel, and raw DNS records all at once.
4. Recovery required a Cloudflare support ticket. The site was down for a period before Cloudflare's backend released the claim on its own and the domain could be re-added to Pages.

**Root cause — confirmed by Cloudflare support** (ticket resolved): a known timing window in Custom Domain claim propagation. When a hostname is removed from one resource, the internal claim record releases asynchronously, not instantly — attaching it to a different resource before that finishes propagating causes both sides to reject it. It clears on its own within minutes to a couple of hours. Cloudflare's own stated guidance: wait a few minutes between removing a Custom Domain from one resource and adding it to another. The reconciliation-lag theory in step 2 above was correct.

**Recommended sequence for next time:**
1. Do this only when able to tolerate a brief outage window, and not during a time the dashboard is being actively relied on operationally (e.g., not mid-flying-session).
2. Remove the domain from its current resource (e.g., Pages).
3. **Wait a few minutes** (per Cloudflare's own confirmed guidance above) before attempting to add it to the new resource (e.g., the Worker) — do not do this back-to-back.
4. Verify via direct DNS check (`dig @1.1.1.1 +short <hostname>`) and a `curl` to the live URL — not just the dashboard, and not just a browser tab (browsers and ISP DNS cache aggressively; a page appearing to "work" after a change can be a stale cached copy, not a live response). Use a private/incognito window for any browser check to avoid this trap.
5. If the add step fails: do not repeat it immediately. Given the confirmed propagation window above, wait longer (up to a couple of hours) before retrying, rather than assuming a stuck claim right away. Check the target resource's Domains panel for anything in a Pending/Error/unusual state. If still stuck well beyond that window, this needs Cloudflare support again — no dashboard action or CLI command (confirmed: `wrangler pages domain add` doesn't exist as a subcommand) can clear a stuck internal claim.
6. Once confirmed working via direct DNS/curl check (not cache), run a full regression sweep: login, org-switcher, weather ingestion + API key auth matrix, multi-display templates, storage quota enforcement, tenant pause toggle.

**Cloudflare plan note:** a "free" plan may only offer community-forum support (community.cloudflare.com) rather than a direct ticket queue — worth checking which support channel is actually available before assuming a formal ticket path exists.
