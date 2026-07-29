// True for any host that resolves this app DIRECTLY (production's own
// *.pages.dev alias, any Cloudflare Pages PREVIEW deployment - a
// per-branch hash subdomain of the same project, e.g.
// 23cb1e4d.shobdon-central.pages.dev - or local dev), as opposed to a
// tenant's own real custom subdomain (shobdon.airfieldcentral.com) or
// an unrelated host entirely. Used everywhere this app compares
// window.location.hostname against a tenant's stored subdomain to
// decide whether a link should stay relative or jump to that real
// subdomain (AdminSidebar.tsx/Header.tsx's own isOnOwnSubdomain,
// DisplayUrlList.tsx's display URLs) - without this, every one of those
// links treated ANY pages.dev host as "not my own subdomain" and jumped
// to production's real subdomain, which is correct for the bare
// production alias (no per-tenant DNS provisioned yet) but wrong for a
// preview deployment, which has its own real, working D1/content and
// should never redirect off itself to production.
//
// Matches functions/api/_utils/resolveTenantHost.ts's own
// FALLBACK_TO_SHOBDON_HOSTS wildcard-preview handling - kept as a
// separate, frontend-only copy rather than a shared import (this
// repo's established functions/src boundary convention, see e.g.
// SafetyNotice's own multiple private copies).
export function isPagesPlatformHost(hostname: string): boolean {
  return hostname.endsWith('.pages.dev') || hostname === 'localhost'
}

// Deliberately narrower than isPagesPlatformHost above - that function
// treats production's own bare shobdon-central.pages.dev alias AND any
// preview deployment's hash subdomain as equally "my own host" (correct
// for the link-redirect decision it exists for). This one exists for a
// different question - "is this NOT the real production site at all" -
// so the bare production alias must return false here while a preview
// hash subdomain (or localhost) returns true. Used by PreviewBanner.tsx
// to show a persistent "this isn't the live site" indicator - a false
// positive on the bare pages.dev alias would incorrectly flag real
// production traffic (still genuinely live for any tenant without
// per-tenant DNS yet, see resolveTenantHost.ts's own fallback), and a
// false negative on a preview hash subdomain is exactly the confusion
// this component exists to prevent (see PreviewBanner.tsx's own
// comment for the report that prompted this).
export function isPreviewDeploymentHost(hostname: string): boolean {
  if (hostname === 'localhost') return true
  if (hostname === 'shobdon-central.pages.dev') return false
  return hostname.endsWith('.shobdon-central.pages.dev')
}
