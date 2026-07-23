import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'

interface VenueCornerBadgeProps {
  airfieldName?: string | null
  logoUrl?: string | null
  // Migration 0039 (Screens Design's Branding tab) - this badge's own
  // 'cafe' brandDisplay slice, independent of Header.tsx's 'main' slice.
  // Both default true - unchanged from today's unconditional "always
  // show both" behaviour for any caller not yet passing these. See
  // Header.tsx's own comment for why this exists: a real club logo
  // (Shobdon's own) often already has the club name baked into the
  // artwork, making the separate text label next to it redundant/
  // visually cluttered rather than an actual CSS overlap.
  showLogo?: boolean
  showName?: boolean
  nameFontSize?: 'sm' | 'md' | 'lg' | 'xl'
}

// 'md' is exactly this component's own previous hardcoded text-sm -
// unchanged default. No responsive sm: breakpoint like Header.tsx's own
// scale (NAME_FONT_SIZE_CLASSES there) - this badge only ever renders
// on a fixed-size café display screen, never a narrow admin viewport.
const NAME_FONT_SIZE_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-2xl',
}

// Café Template's small fixed corner element - logo + name only, not
// part of the ticker rotation. Deliberately NOT Header.tsx itself: that
// component also carries the clock and weather-status slot, neither of
// which belongs floating in a corner. It DOES now carry the same
// config-link behaviour Header.tsx has, though (see below) - that part
// was a genuine gap, not a deliberate omission: git history shows this
// component never had it, from its very first commit, simply because
// nobody wired it up when the café template was built, not because a
// café screen shouldn't be clickable.
//
// Same role-aware destination logic as Header.tsx, duplicated rather
// than shared - this repo's established convention at exactly this kind
// of small-shared-logic boundary (see e.g. BrandDisplaySettings,
// duplicated across publicConfig.ts/tenant/config.ts). useLocation()
// alone is enough to get this right in every context this component
// renders in, with no props needed: '/design' (Screens Design's own
// café preview) falls through to the same bare '/config' Header.tsx
// resolves to there; '/' and '/d/:slug' (the live dashboard/café
// screens, either of which may have no authenticated viewer at all) get
// the same live /api/tenant/me role lookup, falling back to '/login' on
// a 401/failure - the exact same safe, already-proven behaviour
// Header.tsx relies on for its own equally-public '/' rendering, not a
// new exposure for café.
export default function VenueCornerBadge({
  airfieldName,
  logoUrl,
  showLogo = true,
  showName = true,
  nameFontSize = 'md',
}: VenueCornerBadgeProps): JSX.Element {
  const location = useLocation()
  const isConfigPage = location.pathname === '/config'
  const isPublicDashboard = location.pathname === '/' || location.pathname.startsWith('/d/')

  const [dashboardLandingPage, setDashboardLandingPage] = useState('/login')
  useEffect(() => {
    if (!isPublicDashboard) return
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const role = data?.role
        setDashboardLandingPage(
          role === 'atc' ? '/atc-control' : role === 'media' ? '/media-manager' : role === 'cafe' ? '/cafe-media' : role ? '/config' : '/login'
        )
      })
      .catch(() => {
        if (!cancelled) setDashboardLandingPage('/login')
      })
    return () => {
      cancelled = true
    }
  }, [isPublicDashboard])

  const linkTo = isConfigPage ? '/' : isPublicDashboard ? dashboardLandingPage : '/config'

  return (
    <Link
      to={linkTo}
      title={isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
      className="group flex max-w-[220px] items-center gap-2 rounded-xl border border-border bg-panel/90 px-3 py-2 shadow-lg shadow-slate-950/30"
    >
      {showLogo && logoUrl && (
        <div className="h-8 max-w-[80px] shrink-0">
          <img src={logoUrl} alt="" className="h-full w-full object-contain object-left" />
        </div>
      )}
      {showName && (
        <div
          className={`truncate font-black uppercase tracking-wide text-primary transition-colors group-hover:text-accent-sky-400 ${NAME_FONT_SIZE_CLASSES[nameFontSize]}`}
        >
          {airfieldName || 'AIRFIELD CENTRAL'}
        </div>
      )}
    </Link>
  )
}
