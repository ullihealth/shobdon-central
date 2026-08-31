import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { REFRESH_CHECK_URL } from '../config/captureEndpoint'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { isCaptureInProgress } from '../services/captureActivity'
import { isUpdateAvailable, applyUpdate } from '../services/serviceWorkerUpdate'

// Matches '/' (DashboardPage, the "main" display) and '/d/:displaySlug'
// (TenantDisplayPage, named displays) - the only routes personalize-
// tenant.sh's own DASHBOARD_URL is ever actually pointed at (see its own
// README examples: a bare tenant subdomain, or e.g. "/d/cafe-tv"). Every
// other route (admin/editing pages, /login, /pilot, /platform/*) is
// explicitly excluded - see this component's own top comment for why
// that's now load-bearing, not just an optimization.
const PUBLIC_DISPLAY_ROUTE_PATTERN = /^\/(d\/[^/]+)?$/

// Lets a remote trigger (opened from a phone via the Worker's /refresh URL,
// or the platform-admin "Refresh displays" action) force this tab to
// reload - so a fix pushed from home can be picked up on ATC PC2 (or any
// tenant's live dashboard) without touching its keyboard/mouse. Polls a
// per-TENANT flag on the same Worker already used for capture logging.
//
// "Refresh displays" round - this used to poll one single GLOBAL flag,
// so any trigger (including AtcControlPage.tsx's own "Update Dashboard"
// side effect) reloaded EVERY tenant's live screen at once, not just the
// one it was meant for. Per-tenant scoping means this component now
// needs to know its OWN tenant first - it's mounted once at the top of
// App.tsx, above <Routes>, so unlike a page component it has no route
// param or page-level fetch to read that from. Self-fetches
// PUBLIC_CONFIG_URL (Host-header-resolved, same request every tenant
// dashboard already makes on load) purely to learn its own `slug`.
//
// Kiosk-reliability round - a real incident on a live Pi kiosk (Meg's
// Cafe) confirmed this permanently disabled the whole feature for hours:
// the slug lookup used to be a SEPARATE, ONE-SHOT effect with no retry -
// if it failed even once (a network blip at boot, DNS not yet warm - a
// real risk on exactly the kind of cold-boot-and-auto-load Pi this
// component matters most for), tenantSlug stayed null forever and the
// poll loop below never started for the rest of that page's life, fully
// silently. Recovered only because a full Chromium restart gave the
// component a fresh mount and one more attempt. Fixed by folding slug
// resolution INTO the poll loop itself: every tick re-attempts it if
// still unknown, exactly the same "a failure just means try again next
// tick" resilience the refresh-check fetch below already had - there is
// no longer a one-shot step whose single failure can permanently disable
// this feature. On a host with no matching tenant (the login page,
// /platform/* admin routes), this now retries the slug lookup forever
// rather than giving up after one 404 - a harmless extra request every
// 12s on those routes, not a real cost, and no longer a special case to
// get wrong.
//
// `pendingReload` here is the client's own memory of "a reload was
// requested", kept across polls until it's actually safe to act on it.
// Never interrupts an in-progress capture: that's the one constraint that
// matters more than anything else about this feature.
//
// Multi-consumer round (2026-08-28) - a real incident traced an
// INTERMITTENT (not broken) auto-refresh failure on Meg's Cafe's kiosk to
// this component being mounted globally, above <Routes>, meaning it was
// ALSO polling and consuming the exact same per-tenant flag from a
// tenant's own admin/editing pages (e.g. /cafe-media) any time that
// admin had them open - confirmed directly via display_visits showing
// two distinct devices (the Pi kiosk, and a Mac browser) both hitting the
// tenant's "main" display in the same window. The flag was single-
// consumer/delete-on-read at the time: whichever poller's request reached
// the Worker first won, silently starving the other with zero error
// anywhere - the trigger fired correctly every time, this was purely a
// race between two UNINTENDED competing consumers, not a broken poll
// loop. Fixed then by gating on PUBLIC_DISPLAY_ROUTE_PATTERN above - an
// admin's own session should never compete for (or have their own
// editing work interrupted by) a reload tied to their tenant's own
// display, only the actual kiosk/wall-display routes should ever poll
// this at all.
//
// Multi-consumer round 2 (2026-08-31) - that fix assumed "at most one
// real display per tenant, on a public display route" - the 'website'
// carousel slot type broke that assumption legitimately: Meg's Cafe
// embedding Shobdon's own '/' as a carousel slide runs Shobdon's real
// app inside that iframe, including its own instance of THIS component,
// polling Shobdon's own per-tenant flag - a second genuine, sanctioned
// consumer route-scoping alone can't and shouldn't try to exclude.
// display_visits again confirmed two distinct devices (Shobdon's own
// real kiosk, and the embedded copy running inside Meg's Cafe's Pi) both
// polling Shobdon's own "main" display concurrently. The Worker's own
// flag is no longer delete-on-read (see worker/src/index.ts's own
// refreshFlagKey comment) specifically so this no longer matters -
// /refresh-check now always returns the current stored timestamp
// (refreshRequestedAt: string | null), readable by any number of
// independent pollers without affecting each other. lastSeenRefreshAt/
// hasRefreshBaseline below are what makes that safe: the FIRST value
// this component ever reads (whatever's currently stored, which could
// be a timestamp from hours ago) is treated as the existing state of the
// world, not a new trigger - only a LATER read returning a DIFFERENT
// timestamp counts as "something changed since I last checked". Without
// that baseline step, a tab that just reloaded because of timestamp T
// would see T again on its very next poll and reload again, forever -
// the non-consuming flag alone doesn't prevent that on its own, this
// per-client memory is what does.
//
// Offline-resilience round (2026-08-30) - this poll cycle is now ALSO
// the single decision point for "a new deployed version is ready",
// alongside the existing remote-flag check, rather than letting
// src/services/serviceWorkerUpdate.ts's own service-worker registration
// trigger a reload on its own. That module deliberately uses
// registerType: 'prompt' (see vite.config.ts's own comment) specifically
// so it never reloads unilaterally - a kiosk tab that never closes could
// otherwise pick the worst possible moment (mid-capture, or racing this
// exact poll cycle) to force a reload from a completely separate,
// uncoordinated code path. Same isCaptureInProgress() gate covers both
// triggers now, not just the remote-flag one.
const POLL_INTERVAL_MS = 12_000

export default function RemoteRefreshWatcher(): null {
  const location = useLocation()
  const isPublicDisplayRoute = PUBLIC_DISPLAY_ROUTE_PATTERN.test(location.pathname)
  const pendingReload = useRef(false)
  // Refs, not state - nothing here ever affects render output (this
  // component always returns null), so there's no reason to trigger a
  // re-render when the slug resolves or a reload becomes pending.
  const tenantSlug = useRef<string | null>(null)
  // The last refreshRequestedAt value this tab has already accounted for -
  // see "Multi-consumer round 2" above for why the FIRST value read must
  // become this baseline rather than an immediate trigger.
  const lastSeenRefreshAt = useRef<string | null>(null)
  const hasRefreshBaseline = useRef(false)

  useEffect(() => {
    // Covers client-side navigation between a display route and a non-
    // display one within the same tab (e.g. an admin clicking a preview
    // link) - the kiosk's own case never navigates at all, so this is a
    // no-op there; isPublicDisplayRoute is always true for its one fixed
    // URL for the life of the tab.
    if (!isPublicDisplayRoute) return
    let cancelled = false

    async function resolveTenantSlug(): Promise<string | null> {
      try {
        const response = await fetch(PUBLIC_CONFIG_URL)
        if (!response.ok) return null
        const data: { slug?: string | null } = await response.json()
        return data?.slug ?? null
      } catch {
        return null
      }
    }

    async function poll() {
      if (!tenantSlug.current) {
        tenantSlug.current = await resolveTenantSlug()
        if (cancelled) return
        if (!tenantSlug.current) return // not known yet (or no tenant on this host) - try again next tick
      }

      try {
        if (!pendingReload.current) {
          const response = await fetch(`${REFRESH_CHECK_URL}&tenant=${encodeURIComponent(tenantSlug.current)}`)
          if (response.ok) {
            const data: { refreshRequestedAt?: string | null } = await response.json()
            const requestedAt = data.refreshRequestedAt ?? null
            if (!hasRefreshBaseline.current) {
              // First-ever read for this tab/instance - whatever's already
              // stored (possibly hours old) is the existing state of the
              // world, not a new trigger for THIS tab. Treating it as one
              // would make a freshly-mounted watcher immediately reload
              // itself again from the very timestamp that caused the
              // reload it just completed.
              lastSeenRefreshAt.current = requestedAt
              hasRefreshBaseline.current = true
            } else if (requestedAt && requestedAt !== lastSeenRefreshAt.current) {
              pendingReload.current = true
              lastSeenRefreshAt.current = requestedAt
            }
          }
        }
      } catch {
        // No connectivity to the check endpoint right now - try again next poll.
      }

      // Either source is treated identically by the safety gate - a
      // pending SW update just uses applyUpdate() (which activates the
      // new worker AND reloads in one step) instead of a plain reload,
      // since reloading first would still run under the OLD worker for
      // a moment.
      if ((pendingReload.current || isUpdateAvailable()) && !isCaptureInProgress()) {
        if (isUpdateAvailable()) {
          await applyUpdate()
        } else {
          window.location.reload()
        }
      }
    }

    void poll()
    const interval = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isPublicDisplayRoute])

  return null
}
