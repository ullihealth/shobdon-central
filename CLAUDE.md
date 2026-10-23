# Working preferences for this repo

## Verification effort should match risk

For low-risk, visual-only changes (CSS/styling tweaks, copy edits, image/background
swaps, layout spacing) - skip the full verification loop after every edit. Just make
the change, show a diff or screenshot, and ask if further adjustment is wanted.

Reserve full verification (build checks, test suites, migration/deploy dry-runs,
multi-resolution/regression screenshots, Cloudflare status checks) for changes that
touch backend, data, auth, or payments, or when the user explicitly says something
like "that's it, finalize this" or "ship it."

Push visual tweaks right away (commit + push after making the change, same turn) -
the user checks results on the live site, not from screenshots alone. Skipping heavy
verification does not mean holding back the push; those are separate. Still fine to
include a screenshot alongside the push, but don't treat it as a gate before pushing.

## Check mobile width on every UI/layout change

Any UI/layout prompt gets checked at a phone-width viewport (~375px) before being
called done, in addition to desktop - always, not just when explicitly asked.
Absolute-positioned elements over background images are the most likely thing to
break at narrow widths; check those first when present.

## Image assets must use sRGB, not a device-specific colour profile

See IMAGE_ASSETS.md for the full standard and the incident that prompted it (a
device-specific Mac colour profile caused a visible green tint on a real TV,
invisible on a Mac browser). A pre-commit hook (scripts/check-image-color-profile.mjs,
wired via husky/lint-staged) checks staged images under public/ automatically -
but check any new/replaced image asset's ICC profile yourself before committing
regardless, since the hook only helps on a machine it's actually installed on.

## Existing-design guard (applies to every task)

Before proposing or making any change, first find and report what already exists for this area - including separate or parallel mechanisms (e.g. a route with its own service worker, hook or component), code comments describing deliberate behaviour ("only", "deliberately", "never"), and released items on Developer Updates / Developer Features.
Treat existing behaviour as intentional unless I say otherwise.
STOP and ask me before removing, replacing or bypassing anything that is documented as deliberate, or anything that is part of my manual processes (e.g. revision releases, the Pilot's App update system - see README "Pilot's App updates", approval gates).
Fix only the problem I describe, at the size I describe it - do not extend a fix to other routes, devices or tenants unless I ask.

## No long dashes in customer-facing text
Never use em dashes (—) or en dashes (–) in any text a customer, pilot or member of the public can see (UI, messages, emails, display screens, Pi box pages). Use a plain hyphen with spaces ( - ) or rewrite the sentence. Code comments are exempt.

## World-class SaaS rule
Before proposing any feature or fix, work out how top SaaS companies (Stripe, Netflix, Shopify, Slack, Notion, Atlassian, Google Workspace) solve the same problem and propose against that standard. Cover the whole lifecycle (signup, payment, failed payment, suspension, resumption, cancellation, export), every surface (tenant admin web, Pilot's App, TV/Pi boxes, emails, platform admin), and every state (tabs and apps left open for weeks, offline devices, old cached code, multiple users per tenant). Include the standard admin controls (revoke sessions, suspend/resume, audit trail, clear status messaging). Present options ranked and flag anything standard that we are missing. Build only what Jeff has agreed.

## Deployed-devices rule
For any change meant to affect devices already in the field (Pilot's Apps on phones, Pi boxes, TV dashboards, admin pages already open in browsers), the FIRST line of the report must be "Reaches devices running today's code: YES / NO". If NO, say so up front and name the lever that does reach them (server-side change, session revocation, pilot-sw.js, remote box access). Every test plan for such a change must include a device running the currently deployed code.
