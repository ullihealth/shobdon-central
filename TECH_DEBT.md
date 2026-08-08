# Tech Debt

## shobdon-central (Pages project) retirement blockers

_Found 2026-08-08, during the Pilot View pull-to-refresh investigation._

Context: The app originated as a Shobdon-specific project (shobdon-central, Pages) before the multi-tenant pivot to airfield-central (Worker). Most domains previously on Pages are now confirmed served by the Worker instead. One genuine loose end remains before the old Pages project can be safely retired:

1. ~~**airfieldcentral.com (bare apex)** — still served by the stale shobdon-central Pages build (not the current Worker).~~ **RESOLVED 2026-08-08.** `git push` (commit 586c0ad) triggered both deploy targets in sync: the `.github/workflows/deploy-worker.yml` CI workflow redeployed the airfield-central Worker, and Cloudflare Pages' own git integration redeployed shobdon-central (Production deployment `cefeac54`, source `586c0ad`), replacing the previously 19-hour-stale `fb5a2b9` build. Both targets now build from the same commit going forward, on every push.

2. **shobdon-central.pages.dev** — Cloudflare's auto-generated Pages URL. Still depended on by app routing logic (isPagesPlatformHost.ts, resolveTenantHost.ts FALLBACK_TO_SHOBDON_HOSTS) and by dev/preview deployment workflow. Needs a replacement mechanism before Pages project can be retired.

Note: demo.airfieldcentral.com, newcustomer.airfieldcentral.com, and shobdon.airfieldcentral.com are already fully served by the Worker — no action needed there, despite the Pages project still listing them as domains. newcustomer's underlying tenant is load-bearing onboarding template infrastructure — never delete that tenant row regardless of domain routing changes.
