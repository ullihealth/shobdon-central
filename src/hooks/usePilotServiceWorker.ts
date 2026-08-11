import { useCallback, useEffect, useRef, useState } from 'react'

export interface PilotServiceWorkerUpdate {
  // True once a NEW service worker has finished installing and is
  // sitting in registration.waiting behind the one currently
  // controlling this page - see pilot-sw.js's own comment on why
  // skipWaiting() no longer runs unconditionally on install. Never true
  // on a genuinely first-ever /pilot visit (no prior controller to
  // update FROM) - see trackInstallingWorker's own comment below.
  updateAvailable: boolean
  // Tells the waiting worker to activate (postMessage SKIP_WAITING,
  // handled in pilot-sw.js's own message listener) and reloads this
  // page once it actually takes control - never called automatically,
  // only ever in response to a pilot tapping the update banner
  // (PilotUpdateBanner.tsx).
  applyUpdate: () => void
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
// has installed, instead of just registering and forgetting. A pilot
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
  // Guards the reload in handleControllerChange below so it only ever
  // fires in response to OUR OWN applyUpdate() call, not some other,
  // unrelated controllerchange - reloading a pilot's page out from under
  // them mid-read for a reason they didn't ask for would be worse than
  // the stale-bundle bug this hook exists to fix.
  const reloadingRef = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let updateIntervalId: number | undefined

    function handleControllerChange() {
      if (!reloadingRef.current) return
      reloadingRef.current = false
      window.location.reload()
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
        // waiting, it never activates anything on its own, so this
        // can't bypass the tap-to-reload banner above.
        registration.update().catch(() => {})
        updateIntervalId = window.setInterval(() => {
          registration.update().catch(() => {})
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
  }, [waitingWorker])

  return { updateAvailable: !!waitingWorker, applyUpdate }
}
