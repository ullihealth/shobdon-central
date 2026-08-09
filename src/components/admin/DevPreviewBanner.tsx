import { useEffect, useState } from 'react'

interface MeResponse {
  isDeveloper?: boolean
  organizationSlug?: string
  organizationName?: string
  subdomain?: string | null
}

interface PreviewState {
  orgSlug: string
  orgName: string
}

// Persistent "you're previewing another tenant" indicator for every
// AdminLayout-wrapped page (/config, /runways, /members, etc.) reached
// from /platform/preview's own tenant picker - that page already shows
// "Currently previewing: X" inline, but only on itself; the moment a
// developer clicks into Config or Runways from there, that indicator is
// left behind with nothing replacing it. This renders inside
// AdminLayout.tsx specifically (not DeveloperLayout.tsx, which wraps
// /platform/preview itself) - the two never both render at once, so
// there's no risk of a duplicate/redundant banner on the picker page.
//
// Deliberately frontend-only, no backend change: DEV_PREVIEW_ORG_COOKIE
// (functions/api/_utils/tenantAuth.ts) is HttpOnly, unreadable from JS,
// so "is a preview active" can't be read directly from the cookie here.
// Instead this reuses a fact /api/tenant/me already returns - the
// resolved tenant's own real subdomain - compared against
// window.location.hostname, which the browser always knows. If they
// don't match, the page currently being administered isn't the one the
// address bar's own host actually belongs to, which is exactly what a
// preview session (or, narrowly, a developer reaching a real tenant via
// a non-canonical host like the bare pages.dev URL) looks like. Gated
// on isDeveloper too - a non-developer's own real membership always
// resolves via a tier where host and subdomain already agree (tier 3 or
// tier 5 landing on their own tenant), so this can never show for an
// ordinary tenant owner/admin account.
export default function DevPreviewBanner(): JSX.Element | null {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: MeResponse | null) => {
        if (!cancelled) setMe(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const isPreviewing = !!me?.isDeveloper && !!me?.subdomain && me.subdomain !== window.location.hostname
  if (!isPreviewing) return null

  const preview: PreviewState = { orgSlug: me?.organizationSlug ?? '', orgName: me?.organizationName ?? '' }

  async function handleExit() {
    setExiting(true)
    try {
      // Clears DEV_PREVIEW_ORG_COOKIE the same way PlatformPreviewPage's
      // own "Stop previewing" button does - same endpoint, same
      // orgSlug: null shape.
      await fetch('/api/platform/preview-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: null }),
      })
    } finally {
      // Full navigation back to the picker, not a same-page reload -
      // this page's own tenant context is about to change (falls
      // through to whichever tier resolves next, likely this account's
      // own real tenant), so staying put would silently swap the data
      // on screen out from under whoever just clicked this.
      window.location.href = '/platform/preview'
    }
  }

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2">
      <span className="text-sm font-semibold uppercase tracking-wide text-amber-400">
        Previewing: <span className="text-white">{preview.orgName}</span>
        {preview.orgSlug && <span className="text-amber-400/70"> ({preview.orgSlug})</span>}
      </span>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        className="rounded-lg border border-amber-500/40 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-300 transition hover:border-amber-400 hover:text-amber-200 disabled:opacity-50"
      >
        {exiting ? 'Exiting…' : 'Exit preview'}
      </button>
    </div>
  )
}
