# Working preferences for this repo

## Verification effort should match risk

For low-risk, visual-only changes (CSS/styling tweaks, copy edits, image/background
swaps, layout spacing) - skip the full verification loop after every edit. Just make
the change, show a diff or screenshot, and ask if further adjustment is wanted.

Reserve full verification (build checks, test suites, migration/deploy dry-runs,
multi-resolution/regression screenshots, Cloudflare status checks) for changes that
touch backend, data, auth, or payments, or when the user explicitly says something
like "that's it, finalize this" or "ship it."

Don't deploy low-risk visual tweaks until the user confirms they're happy with the
screenshot - iterate locally first.
