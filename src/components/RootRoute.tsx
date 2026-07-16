import DashboardPage from '../pages/DashboardPage'
import LandingPage from '../pages/LandingPage'

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
// before this file existed.
const LANDING_HOSTS = new Set(['airfieldcentral.com', 'www.airfieldcentral.com'])

export default function RootRoute(): JSX.Element {
  return LANDING_HOSTS.has(window.location.hostname) ? <LandingPage /> : <DashboardPage />
}
