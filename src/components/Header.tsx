import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { authClient } from '../lib/auth/authClient'

interface HeaderProps {
  rightSlot?: ReactNode
}

export default function Header({ rightSlot }: HeaderProps): JSX.Element {
  const [now, setNow] = useState(new Date())
  const location = useLocation()
  const navigate = useNavigate()
  const isConfigPage = location.pathname === '/config'
  const isPublicDashboard = location.pathname === '/'
  // Shown only when a real session exists - most viewers of the public
  // dashboard ('/') aren't logged in at all, so this naturally stays
  // hidden there for the common case, while still covering the shared-PC
  // case where a staff member is logged in and viewing '/'. Absolutely
  // positioned so it never disturbs the existing title/clock/rightSlot
  // layout, which differs per page (rightSlot is empty on /config, a
  // weather indicator on / and /design).
  const { data: session } = authClient.useSession()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await authClient.signOut()
    navigate('/login')
  }

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

  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const lastUpdatedString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
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

      {session && (
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="absolute right-4 top-1.5 text-xs font-semibold text-muted-300 transition hover:text-status-bad disabled:opacity-50"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      )}
    </div>
  )
}
