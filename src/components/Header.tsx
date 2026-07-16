import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'

interface HeaderProps {
  rightSlot?: ReactNode
}

export default function Header({ rightSlot }: HeaderProps): JSX.Element {
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
    <div className="relative h-full w-full rounded-xl bg-gradient-to-r from-header-from via-header-via to-header-to p-3 shadow-lg flex items-center justify-between px-5">
      {/* Left - title (doubles as the Configuration nav control) with Last Updated, read as one info block */}
      <Link
        to={isConfigPage ? '/' : isPublicDashboard ? dashboardLandingPage : '/config'}
        className="group flex flex-col cursor-pointer"
        title={isConfigPage ? 'Back to Dashboard' : 'Weather Config'}
      >
        <div className="text-3xl font-black uppercase tracking-wide text-primary transition-colors group-hover:text-accent-sky-400">
          SHOBDON AIRFIELD
        </div>
        <div className="text-sm font-medium text-muted-300 leading-tight">Last updated {lastUpdatedString}</div>
      </Link>

      {/* Centre - large clock, absolutely centred against the full header width */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <div className="text-5xl font-extrabold text-primary">{timeString}</div>
      </div>

      {/* Right - optional slot (e.g. weather status indicator on the dashboard) */}
      {rightSlot}
    </div>
  )
}
