import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { resolveDashboardLandingPage } from '../utils/dashboardLandingPage'

// Fullscreen carousel slots (autoFullscreen: true - video/webcam/website
// embeds) are portaled straight to document.body at z-50 (see
// MediaPanel.tsx's own portal comment), which covers Header.tsx/
// VenueCornerBadge.tsx completely regardless of their own z-index: once
// a tenant enables the overscan safe-margin feature, OverscanSafeFrame.tsx's
// `transform: scale()` gives every in-tree `fixed` descendant (including
// a raised-z-index Header) a new containing block, capping it below any
// document.body-level portal no matter how high that z-index goes
// (FullBufferGate.tsx's own two overlays already have this exact limit).
// The only way to reliably win against a body-level portal in every case
// is to also be a body-level portal - hence this component, rather than
// just bumping Header's z-index.
//
// Deliberately generic (a plain settings glyph, not the tenant's logo/
// name) rather than a second copy of Header - showing an actual brand
// mark on top of playing video/website content every fullscreen moment
// would be the visually intrusive outcome Jeff explicitly didn't want,
// and a generic affordance sidesteps the "which tenant does this belong
// to" question rather than needing to get it right. The link TARGET is
// still always correct without any special-casing: this component is
// instantiated by the outer tenant's own React app (self-fetching its
// own /api/tenant/me exactly like Header does), so on a `websiteFixedCanvas`
// slide embedding another tenant's dashboard, this always resolves to
// the OUTER tenant's own page - the embedded tenant's app is a fully
// independent, cross-origin iframe this component has no relationship
// to at all, and this overlay's higher z-index simply paints over
// whatever that iframe shows in the same corner.
export default function PersistentConfigLink(): JSX.Element | null {
  const [href, setHref] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setHref(resolveDashboardLandingPage(data?.role, data?.tenantType))
      })
      .catch(() => {
        if (!cancelled) setHref('/login')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!href) return null

  // ~20% opacity by default (always visible, never hover-only - a TV/
  // touch kiosk has no discoverable hover state, so hover-to-reveal would
  // make this practically unreachable there), full opacity on hover for
  // desktop admin use. Hit area (p-3, well past the visible glyph) is
  // generous on purpose: it needs to reliably win the click over an
  // embedded iframe sitting underneath it.
  return createPortal(
    <Link
      to={href}
      title="Settings"
      className="fixed left-4 top-4 z-[60] rounded-full p-3 text-white opacity-20 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </Link>,
    document.body
  )
}
