import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import DevPreviewBanner from './DevPreviewBanner'
import { LockedShell, SubscriptionTakeover, type TakeoverMe } from './SubscriptionTakeover'
import { installAdminFetchGuard, SESSION_EXPIRED_EVENT, SUBSCRIPTION_INACTIVE_EVENT } from '../../lib/adminFetchGuard'
import { isAdminLocked, isPathAllowedWhileLocked } from '../../utils/subscriptionLock'
import { activateLatestWorker, CURRENT_BUILD_ID, fetchLatestBuildId, getReloadedFor, markReloadedFor, shouldReloadForBuild, VERSION_CHECK_INTERVAL_MS } from '../../lib/appVersion'
import { clearDirty, isSafeToReload } from '../../lib/unsavedWorkGuard'

// How often the tenant's suspended / resumed state is re-read while the tab is visible.
const STATUS_CHECK_INTERVAL_MS = 60_000
// "Updating to the latest version..." is shown this long before a safe-moment reload.
const UPDATE_NOTICE_MS = 2500
// A deferred update (unsaved work / a save in flight) is retried this often.
const UPDATE_RETRY_MS = 10_000

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
// straight to the login page (a FULL page load - see goToLogin). A failed /me read
// never locks anyone.
//
// LIVE CHECKS (no click, no reload): while the tab is visible /api/tenant/me is
// re-read every 60 s, so a tenant being suspended or resumed switches the page at
// once; checks pause while the tab is hidden and run again as soon as it is shown.
//
// ALWAYS THE LATEST CODE: the tab compares its build id with /version.json on
// focus / visibility and every 5 minutes (lib/appVersion.ts) and reloads onto the
// new build at a safe moment - never while a form has unsaved edits or a save /
// upload is in flight (lib/unsavedWorkGuard.ts); a deferred update is applied at
// the user's next navigation instead. At most one reload per new build id.
export default function AdminLayout(): JSX.Element {
  const location = useLocation()
  const [me, setMe] = useState<(TakeoverMe & { subscriptionActive?: unknown; isDeveloper?: unknown }) | null>(null)
  const [forcedLocked, setForcedLocked] = useState(false)
  const [updatingNotice, setUpdatingNotice] = useState(false)
  const leavingRef = useRef(false)
  // A newer build exists but could not be applied yet (unsaved work / a save in flight).
  const updatePendingRef = useRef<string | null>(null)
  const updateBusyRef = useRef(false)

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

  // Reload onto the new build: install + activate the new service worker first (else
  // the page shell would come from the old precache again), then a full page load.
  const applyUpdate = useCallback(async (buildId: string, target?: string) => {
    if (updateBusyRef.current) return
    updateBusyRef.current = true
    markReloadedFor(buildId)
    await activateLatestWorker()
    if (target) window.location.assign(target)
    else window.location.reload()
  }, [])

  // Apply a pending update if (and only if) it is safe right now: shows the small
  // notice first, then re-checks that nothing became unsafe in the meantime.
  const tryApplyPendingUpdate = useCallback(() => {
    const buildId = updatePendingRef.current
    if (!buildId || updateBusyRef.current || !isSafeToReload()) return
    setUpdatingNotice(true)
    window.setTimeout(() => {
      if (isSafeToReload()) void applyUpdate(buildId)
      else setUpdatingNotice(false)
    }, UPDATE_NOTICE_MS)
  }, [applyUpdate])

  const checkVersion = useCallback(async () => {
    const latest = await fetchLatestBuildId()
    if (!shouldReloadForBuild(CURRENT_BUILD_ID, latest, getReloadedFor())) return
    updatePendingRef.current = latest
    tryApplyPendingUpdate()
  }, [tryApplyPendingUpdate])

  useEffect(() => {
    void checkVersion()
    const interval = window.setInterval(() => void checkVersion(), VERSION_CHECK_INTERVAL_MS)
    const retry = window.setInterval(tryApplyPendingUpdate, UPDATE_RETRY_MS)
    const onFocus = () => void checkVersion()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVersion()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      window.clearInterval(retry)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [checkVersion, tryApplyPendingUpdate])

  // Suspended / resumed state, re-read every 60 s while the tab is visible.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshMe()
    }, STATUS_CHECK_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [refreshMe])

  // Moving to another page: unsaved edits on the old page are gone anyway, so this is
  // the natural moment to apply a deferred update (a full load of the page the user
  // asked for, on the new code), and the new page starts clean.
  const lastPathRef = useRef(location.pathname)
  useEffect(() => {
    if (lastPathRef.current === location.pathname) return
    lastPathRef.current = location.pathname
    clearDirty()
    const buildId = updatePendingRef.current
    if (buildId && !updateBusyRef.current) void applyUpdate(buildId, `${location.pathname}${location.search}${location.hash}`)
  }, [location.pathname, location.search, location.hash, applyUpdate])

  const updatingBanner = updatingNotice ? (
    <div role="status" className="fixed bottom-4 right-4 z-[100] rounded-lg border border-accent-sky-500/50 bg-slate-900/95 px-4 py-3 text-sm font-semibold text-accent-sky-400 shadow-xl">
      Updating to the latest version...
    </div>
  ) : null

  if (forcedLocked) {
    if (isPathAllowedWhileLocked(location.pathname)) {
      return (
        <LockedShell me={me}>
          <Outlet />
          {updatingBanner}
        </LockedShell>
      )
    }
    return (
      <>
        <SubscriptionTakeover me={me} onChanged={refreshMe} />
        {updatingBanner}
      </>
    )
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
      {updatingBanner}
    </div>
  )
}
