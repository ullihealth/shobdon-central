import { useCallback, useEffect, useRef, useState } from 'react'
import { createUpdateChecker } from '../utils/pilotUpdateCheck'
import { createReloadOnce, FORCE_FALLBACK_RELOAD_MS, runForcedUpdate } from '../utils/pilotForceUpdate'

export interface PilotServiceWorkerUpdate {
  // True once a NEW service worker has finished installing and is
  // sitting in registration.waiting behind the one currently
  // controlling this page - see pilot-sw.js's own comment on why
  // skipWaiting() no longer runs unconditionally on install. Never true
  // on a genuinely first-ever /pilot visit (no prior controller to
  // update FROM) - see trackInstallingWorker's own comment below.
  updateAvailable: boolean
  // Tells the waiting worker to activate (postMessage SKIP_WAITING, handled in
  // pilot-sw.js's own message listener) and reloads this page once it takes
  // control. Called by the "Update now" box (PilotUpdateBanner.tsx) when the
  // pilot taps it, and automatically by PilotViewPage.tsx right after a RELEASE
  // when AUTO_FORCE_UPDATE_ON_RELEASE is on (src/config/pilotUpdatePolicy.ts).
  applyUpdate: () => void
  // Developer "Force Pilot App update" / any other forced path: asks the
  // browser for the newest worker, activates a waiting one, then reloads
  // (once). Resolves 'failed' - having reloaded NOTHING - when offline or when
  // the check itself fails. See runForcedUpdate in utils/pilotForceUpdate.ts.
  forceUpdate: () => Promise<'reloading' | 'failed'>
  // "Is a new version waiting?" check (pull-to-refresh and the 60-second tick
  // in PilotViewPage.tsx): the same registration.update() the app runs on open
  // and every 6 hours, rate-limited to once per 30 seconds and safe to call at
  // any time - it never throws, never activates a worker and never reloads
  // itself. If it finds a newer version the update box appears (or, right
  // after a release, the app updates itself - see applyUpdate above).
  checkForUpdate: () => void
}

// Pilot View - registers public/pilot-sw.js, scoped to /pilot only (not
// the whole app - every other route is untouched by this). Genuine
// installed-app PWA behaviour (what this hook is for) needs a real
// service worker with a fetch handler - a manifest + apple-touch-icon
// alone only gets "Add to Home Screen" on iOS specifically, not the
// broader install criteria most platforms actually check for. Silently
// no-ops in a browser/WebView with no serviceWorker support rather than
// throwing - installability is a progressive enhancement here, never a
// requirement for the page to function.
//
// Update-banner round: this hook now also surfaces WHEN a newer version
// has installed, instead of just registering and forgetting. (Update policy,
// superseding the original tap-only rule: a new version is applied by the
// pilot tapping "Update now", automatically after a release, or on a developer
// "Force Pilot App update" - see README "Pilot's App updates".) A pilot
// who adds /pilot to their home screen and reopens it days later was
// otherwise stuck on whatever JS bundle first loaded into that tab -
// clients.claim() (pilot-sw.js's own activate handler) only ever
// controls FUTURE fetches from open tabs, it can't retroactively
// refresh a bundle that's already sitting in memory, so without this,
// nothing ever prompted a reload at all.
//
// How often to ask the browser to re-check pilot-sw.js for a new byte-
// for-byte version while the app stays open in the background/
// foreground, on top of the update check the browser already runs on
// every fresh navigation to /pilot on its own. Deliberately light-touch
// - this is a low-traffic page a pilot might leave open for hours
// before a flight, not somewhere that benefits from aggressive polling,
// and registration.update() itself is cheap (a single conditional-GET-
// style byte comparison against pilot-sw.js, not a full app refetch).
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function usePilotServiceWorker(): PilotServiceWorkerUpdate {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  // Set only while WE are activating a waiting worker (applyUpdate /
  // forceUpdate), so handleControllerChange below reloads in response to OUR
  // activation and never to some other, unrelated controllerchange.
  const reloadingRef = useRef(false)
  // However many paths ask for a reload (controllerchange, the fallback timer,
  // a plain reload), the page reloads at most once.
  const reloadOnceRef = useRef(createReloadOnce(() => window.location.reload()))
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const updateCheckerRef = useRef(createUpdateChecker({ getRegistration: () => registrationRef.current }))

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let updateIntervalId: number | undefined

    function handleControllerChange() {
      if (!reloadingRef.current) return
      reloadingRef.current = false
      reloadOnceRef.current()
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    // A worker sitting in `installed` state WITH an existing controller
    // present is genuinely a waiting update - a brand new /pilot visit
    // with no service worker yet also passes through `installed`, but
    // has no controller at that point (nothing has ever taken control of
    // this page before), and the browser activates that first worker on
    // its own without waiting - so gating on navigator.serviceWorker.
    // controller here is what tells the two cases apart, not a redundant
    // check.
    function trackInstallingWorker(worker: ServiceWorker) {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          setWaitingWorker(worker)
        }
      })
    }

    navigator.serviceWorker
      .register('/pilot-sw.js', { scope: '/pilot' })
      .then((registration) => {
        registrationRef.current = registration
        // Covers the case where a worker already finished installing
        // and started waiting BEFORE this particular page load (e.g. a
        // background update from an earlier tab/periodic check) - by
        // definition that can only happen with a prior controller
        // already in place, so no extra guard needed here.
        if (registration.waiting) setWaitingWorker(registration.waiting)
        registration.addEventListener('updatefound', () => {
          if (registration.installing) trackInstallingWorker(registration.installing)
        })

        // One check right away (catches a version that shipped while
        // this pilot's browser had pilot-sw.js's own HTTP response
        // cached from an earlier visit), then again every
        // UPDATE_CHECK_INTERVAL_MS for as long as this tab stays open -
        // update() itself only ever moves a new script into installing/
        // waiting, it never activates anything on its own.
        registration.update().catch(() => {})
        updateCheckerRef.current.noteCheck()
        updateIntervalId = window.setInterval(() => {
          registration.update().catch(() => {})
          updateCheckerRef.current.noteCheck()
        }, UPDATE_CHECK_INTERVAL_MS)
      })
      .catch(() => {})

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      if (updateIntervalId !== undefined) window.clearInterval(updateIntervalId)
    }
  }, [])

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return
    reloadingRef.current = true
    waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    // If controllerchange never arrives, still reload (once).
    window.setTimeout(reloadOnceRef.current, FORCE_FALLBACK_RELOAD_MS)
  }, [waitingWorker])

  const forceUpdate = useCallback(
    () =>
      runForcedUpdate({
        getRegistration: () => registrationRef.current,
        isOnline: () => navigator.onLine,
        reload: reloadOnceRef.current,
        onActivating: () => {
          reloadingRef.current = true
        },
      }),
    []
  )

  const checkForUpdate = useCallback(() => {
    updateCheckerRef.current.check()
  }, [])

  return { updateAvailable: !!waitingWorker, applyUpdate, forceUpdate, checkForUpdate }
}
