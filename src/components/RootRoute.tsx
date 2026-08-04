import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import DashboardPage from '../pages/DashboardPage'
import LandingPage from '../pages/LandingPage'
import ComingSoonPage from '../pages/ComingSoonPage'
import { PUBLIC_LANDING_MODE_URL } from '../config/publicApi'
import { isMobileDevice } from '../utils/isMobileDevice'

// Used as the element for both "/" and "*" in App.tsx - the client-side
// half of Stage 5's landing page. resolveTenantHost.ts (server-side)
// only ever decides which tenant's DATA an API call resolves to; it has
// no influence on which React component renders, since this is a pure
// client-rendered SPA and React Router only ever sees the path, never
// the hostname. This is that missing piece: a hostname check at the one
// place ("/") where the two pages would otherwise be indistinguishable.
//
// Both "/" and "*" route here (not just "/") so a mistyped URL on the
// marketing domain lands on the marketing homepage, not - if it fell
// through to DashboardPage the way the kiosk's own typo-resilience
// works - Shobdon's operational dashboard.
//
// Every other hostname (shobdon.airfieldcentral.com, shobdon-central.
// pages.dev, localhost, and any future tenant subdomain) falls through
// to the `else` branch - DashboardPage, completely unchanged from
// before this file existed. Crucially, the landing_page_mode fetch
// below only ever runs inside the LANDING_HOSTS branch - a tenant
// subdomain never calls it and is completely unaffected by its value
// either way.
const LANDING_HOSTS = new Set(['airfieldcentral.com', 'www.airfieldcentral.com'])

export default function RootRoute(): JSX.Element {
  const isLandingHost = LANDING_HOSTS.has(window.location.hostname)

  // Coming-soon toggle (functions/api/public/landing-mode.ts,
  // DeveloperToolsPage.tsx's own toggle card writes it) - defaults to
  // the same 'coming_soon' the backend itself fails safe to, so the
  // brief pre-fetch window never flashes the real site even for an
  // instant. null is never rendered as its own state; it's just the
  // seed value here, indistinguishable from a resolved 'coming_soon'.
  const [mode, setMode] = useState<'coming_soon' | 'live'>('coming_soon')

  useEffect(() => {
    if (!isLandingHost) return
    let cancelled = false
    fetch(PUBLIC_LANDING_MODE_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.mode === 'live') setMode('live')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isLandingHost])

  // Mobile gating round - phones land on /pilot instead of the TV/
  // carousel dashboard; tablets and desktop browsers are unaffected (see
  // isMobileDevice's own comment on why both signals - UA and screen
  // width - are required together). Deliberately only in this branch,
  // not the landing-host one above: a mobile visit to the bare marketing
  // domain has no tenant identity for /pilot to resolve against, so
  // there's nothing to redirect it to. /pilot's own mobile_enabled
  // gating (migration 0071) decides locked vs unlocked from here - this
  // redirect doesn't duplicate or pre-check that, it just gets a phone
  // to the right ROUTE.
  if (!isLandingHost) return isMobileDevice() ? <Navigate to="/pilot" replace /> : <DashboardPage />
  return mode === 'live' ? <LandingPage /> : <ComingSoonPage />
}
