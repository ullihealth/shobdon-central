import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import DevPreviewBanner from './DevPreviewBanner'
import { SubscriptionLockBanner, SubscriptionLockedPanel } from './SubscriptionLockBanner'
import { isAdminLocked, isPathAllowedWhileLocked } from '../../utils/subscriptionLock'

// Shared shell for every authenticated admin page (/config, /design,
// /runways, /members, /media-manager, /atc-control, /account,
// /developertools) - rendered once as a React Router layout route wrapping
// all of them, replacing each page's own previously-duplicated header/back-
// link/account row. Per-route access gating (RequireAuth) is unchanged and
// still wraps each individual child route in App.tsx - this component only
// owns the persistent nav chrome, nothing about auth.
//
// Suspended-tenant lock (Jeff's decision; the real lock is server-side in
// tenantAuth.ts requireTenant): for a SUSPENDED tenant's non-developer users the
// sidebar greys out everything except My Account, a banner explains why, and a
// direct link to any other admin page shows the same message instead of the
// page (so it never mounts and never fires requests that would 403). One small
// /api/tenant/me read here, same as the sidebar and RequireAuth each do. A
// failed read never locks anyone, and ordinary tenants render exactly as before
// (the page mounts immediately; only a confirmed lock swaps it out).
export default function AdminLayout(): JSX.Element {
  const location = useLocation()
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setLocked(isAdminLocked(data))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const blockPage = locked && !isPathAllowedWhileLocked(location.pathname)

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <AdminSidebar locked={locked} />
      <main className="min-w-0 flex-1">
        {/* Renders null for every ordinary tenant admin - only shows when
            the page currently being administered doesn't match the host
            in the address bar (see that component's own comment for the
            full detection logic). Its own sticky top-0 keeps it pinned
            at the top of THIS scroll container as a long admin page
            scrolls, rather than a page-level fixed overlay that would
            need its own z-index coordination against every page's own
            content. */}
        <DevPreviewBanner />
        {locked && <SubscriptionLockBanner />}
        {blockPage ? <SubscriptionLockedPanel /> : <Outlet />}
      </main>
    </div>
  )
}
