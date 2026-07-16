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
