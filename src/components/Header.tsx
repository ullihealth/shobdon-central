import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'

interface HeaderProps {
  rightSlot?: ReactNode
  // Real tenant display name (tenants.name via the public config /
  // tenant config response's airfieldName field) - was a hardcoded
  // "SHOBDON AIRFIELD" literal until the pre-onboarding branding audit
  // caught it (every tenant's dashboard showed Shobdon's name
  // regardless of hostname). Undefined/null covers both the brief
  // window before a fetch resolves and a genuinely brand-new tenant
  // with nothing configured yet - the generic fallback below is
  // correct for both, never another tenant's real name.
  airfieldName?: string | null
  // Uploaded tenant logo (tenants.logo_r2_key, resolved to a public R2
  // URL). Null/undefined (no logo set) renders nothing extra - falls
  // back to the text-only layout unchanged.
  logoUrl?: string | null
  // DesignPage.tsx's Solid/Gradient toggle (DesignTemplate.gradientMode) -
  // 'solid' swaps the 3-stop from/via/to gradient for a flat fill using
  // just the `via` stop. Undefined/omitted (every existing caller) keeps
  // today's gradient unchanged - this is purely additive.
  gradientMode?: 'solid' | 'gradient'
}

export default function Header({ rightSlot, airfieldName, logoUrl, gradientMode = 'gradient' }: HeaderProps): JSX.Element {
  const [now, setNow] = useState(new Date())
  const location = useLocation()
  const isConfigPage = location.pathname === '/config'
  // '/d/:displaySlug' (tenant_displays, migration 0027) is a second public
  // dashboard route alongside '/' - same role-aware title-link behaviour
  // applies there too, otherwise a viewer on a named display's title link
  // would incorrectly fall through to the owner-only '/config' target.
  const isPublicDashboard = location.pathname === '/' || location.pathname.startsWith('/d/')

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  // Role-aware header link, public dashboard only - /config and /design
  // (the other two pages this Header renders on) are already owner/admin-
  // gated, so a bare '/config' target there is always correct with no
  // lookup needed. On '/' the viewer could be anyone: not logged in,
  // owner/admin, atc, or media, so this reuses the exact same
  // /api/tenant/me check the post-login redirect already uses, rather
  // than duplicating that role->page mapping a third time (RequireAuth's
  // "Not authorized" safety-net link is the second).
  const [dashboardLandingPage, setDashboardLandingPage] = useState('/login')
  useEffect(() => {
    if (!isPublicDashboard) return
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const role = data?.role
        setDashboardLandingPage(role === 'atc' ? '/atc-control' : role === 'media' ? '/media-manager' : role ? '/config' : '/login')
      })
      .catch(() => {
        if (!cancelled) setDashboardLandingPage('/login')
      })
    return () => {
      cancelled = true
    }
  }, [isPublicDashboard])

  // timeZone: AIRFIELD_TIMEZONE, not the viewing device's own local zone -
  // this clock represents the airfield's actual local time (what a pilot
  // or ATC reading it on-site needs), not whatever timezone the browser/
  // TV's own system clock happens to be set to. A device with a
  // misconfigured clock, or a browser session behind a VPN in another
  // region, would otherwise show a plausible-looking but wrong time.
  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: AIRFIELD_TIMEZONE,
  })

  const lastUpdatedString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: AIRFIELD_TIMEZONE,
  })

  return (
    <div
      className={`relative h-full w-full rounded-xl p-3 shadow-lg flex items-center justify-between gap-2 px-3 sm:px-5 ${
        gradientMode === 'solid' ? 'bg-header-via' : 'bg-gradient-to-r from-header-from via-header-via to-header-to'
      }`}
    >
      {/* Left - title (doubles as the Configuration nav control) with Last Updated, read as one info block.
          min-w-0 + truncate: a flex child otherwise refuses to shrink below its text's own natural width,
          which is what was pushing the clock (below) into overlapping it at narrow widths. */}
      <Link
        to={isConfigPage ? '/' : isPublicDashboard ? dashboardLandingPage : '/config'}
        className="group flex min-w-0 flex-col cursor-pointer"
        title={isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
      >
        <div className="flex min-w-0 items-center gap-2">
          {logoUrl && (
            // shrink-0 + capped max-width: a logo of any aspect ratio must
            // never be allowed to grow and push the centred clock (below)
            // out of position - the exact narrow-width collision this
            // file's own comments already document for the title text.
            // h-full + object-contain (never object-cover/fixed w+h)
            // guarantees no distortion and no cropping regardless of the
            // uploaded image's native dimensions.
            <div className="h-8 max-w-[100px] shrink-0 sm:h-12 sm:max-w-[160px]">
              <img src={logoUrl} alt="" className="h-full w-full object-contain object-left" />
            </div>
          )}
          <div className="truncate text-lg font-black uppercase tracking-wide text-primary transition-colors group-hover:text-accent-sky-400 sm:text-3xl">
            {airfieldName || 'AIRFIELD CENTRAL'}
          </div>
        </div>
        {/* Hidden below sm - at that width there isn't room for a second line
            alongside the clock and status slot without forcing the title to
            shrink further than it already has to. */}
        <div className="hidden text-sm font-medium text-muted-300 leading-tight sm:block">Last updated {lastUpdatedString}</div>
      </Link>

      {/* Centre - large clock, absolutely centred against the full header
          width from sm up. Below sm, absolute positioning is exactly what
          caused the overlap (it ignored the title's actual width entirely) -
          a normal flex item instead, sized down, takes its place in the row
          between the title and rightSlot with no collision. */}
      <div className="flex-shrink-0 sm:absolute sm:left-1/2 sm:-translate-x-1/2">
        <div className="text-lg font-extrabold text-primary sm:text-5xl">{timeString}</div>
      </div>

      {/* Right - optional slot (e.g. weather status indicator on the dashboard) */}
      {rightSlot}
    </div>
  )
}
