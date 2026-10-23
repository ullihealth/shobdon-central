import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import DevPreviewBanner from './DevPreviewBanner'
import { LockedShell, SubscriptionTakeover, type TakeoverMe } from './SubscriptionTakeover'
import { installAdminFetchGuard, SESSION_EXPIRED_EVENT, SUBSCRIPTION_INACTIVE_EVENT } from '../../lib/adminFetchGuard'
import { isAdminLocked, isPathAllowedWhileLocked } from '../../utils/subscriptionLock'

// Shared shell for every authenticated admin page (/config, /design,
// /runways, /members, /media-manager, /atc-control, /account,
// /developertools) - rendered once as a React Router layout route wrapping
// all of them, replacing each page's own previously-duplicated header/back-
// link/account row. Per-route access gating (RequireAuth) is unchanged and
// still wraps each individual child route in App.tsx - this component owns the
// persistent nav chrome and the session / subscription state of the whole app.
//
// SUSPENDED-TENANT LOCK (Jeff's decision; the real lock is server-side in
// tenantAuth.ts requireTenant): for a suspended tenant's non-developer users the
// whole admin app is replaced by ONE full-page "Your subscription isn't active"
// screen (SubscriptionTakeover) - no sidebar, no admin pages; only My Account and
// Billing open, in a minimal shell. It switches on:
//   - /api/tenant/me saying subscriptionActive false (on load, and re-checked
//     whenever the tab regains focus / becomes visible - so Resume or a new
//     suspension is picked up without a manual refresh);
//   - ANY /api/tenant/* response of 403 "Subscription not active" anywhere in the
//     app (lib/adminFetchGuard.ts) - immediately, with no half-working page or
//     error toast.
// A revoked / expired session (401 anywhere, or /me answering 401) sends the tab
// straight to the login page. A failed /me read never locks anyone.
export default function AdminLayout(): JSX.Element {
  const location = useLocation()
  const [me, setMe] = useState<(TakeoverMe & { subscriptionActive?: unknown; isDeveloper?: unknown }) | null>(null)
  const [forcedLocked, setForcedLocked] = useState(false)
  const leavingRef = useRef(false)

  const goToLogin = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    window.location.assign('/login')
  }, [])

  const refreshMe = useCallback(() => {
    fetch('/api/tenant/me')
      .then((response) => {
        if (response.status === 401) {
          goToLogin()
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (!data) return
        setMe(data)
        // The server's answer is authoritative: clears a lock forced by an earlier 403 once the tenant is resumed.
        setForcedLocked(isAdminLocked(data))
      })
      .catch(() => {})
  }, [goToLogin])

  useEffect(() => {
    const uninstall = installAdminFetchGuard()
    const onSessionExpired = () => goToLogin()
    const onInactive = () => {
      setForcedLocked(true)
      refreshMe()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
    window.addEventListener(SUBSCRIPTION_INACTIVE_EVENT, onInactive)
    refreshMe()
    // Re-check when the user comes back to the tab / window.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshMe()
    }
    window.addEventListener('focus', refreshMe)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      uninstall()
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
      window.removeEventListener(SUBSCRIPTION_INACTIVE_EVENT, onInactive)
      window.removeEventListener('focus', refreshMe)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [goToLogin, refreshMe])

  if (forcedLocked) {
    if (isPathAllowedWhileLocked(location.pathname)) {
      return (
        <LockedShell me={me}>
          <Outlet />
        </LockedShell>
      )
    }
    return <SubscriptionTakeover me={me} onChanged={refreshMe} />
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <AdminSidebar />
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
        <Outlet />
      </main>
    </div>
  )
}
