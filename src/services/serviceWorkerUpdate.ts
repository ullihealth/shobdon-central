// Kiosk offline-resilience round - registers the app-shell-precaching
// service worker (vite.config.ts's own VitePWA block owns what's
// actually cached/excluded) and exposes a plain module-level "is a new
// version ready" signal, same "plain module state, not React state"
// convention as captureActivity.ts's own isCaptureInProgress - nothing
// here should trigger a re-render, and RemoteRefreshWatcher.tsx (the
// only reader) already re-checks on its own poll cycle regardless.
//
// Deliberately NOT calling updateServiceWorker() automatically the
// instant a new version is detected (registerType: 'prompt' in
// vite.config.ts is what makes that true) - see this module's own
// applyUpdate() for why the actual reload is left entirely to
// RemoteRefreshWatcher.tsx's existing, already-tested pathway instead of
// happening here as a second, uncoordinated trigger.
import { registerSW } from 'virtual:pwa-register'

// Matches vite-pwa's own documented pattern for a page that stays open
// indefinitely and rarely/never navigates (a kiosk tab, by design) - the
// browser's own native update check only fires on navigation, which a
// kiosk essentially never does on its own. 1 hour, not tighter - this is
// a "pick up a new deploy eventually, in the background" concern, not a
// time-critical one (that's what RemoteRefreshWatcher's own 12s poll is
// for), and matches the interval vite-pwa's own docs use as their
// reasonable-default example.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

let updateAvailable = false
let applyUpdateFn: ((reloadPage?: boolean) => Promise<void>) | null = null

export function isUpdateAvailable(): boolean {
  return updateAvailable
}

// Called by RemoteRefreshWatcher.tsx from its own already-safety-gated
// poll cycle (the same isCaptureInProgress() check that guards the
// remote-flag reload path) - never called automatically by this module.
// updateServiceWorker(true) activates the waiting worker AND reloads the
// page itself (confirmed against vite-pwa's own docs) - this deliberately
// does NOT also call window.location.reload() separately, which would
// reload under the OLD worker a moment before the new one takes over.
export async function applyUpdate(): Promise<void> {
  if (!applyUpdateFn) return
  await applyUpdateFn(true)
}

// Called once, at app startup (src/main.tsx) - never inside a React
// effect, so it runs exactly once regardless of StrictMode's dev-only
// double-invoke behaviour. Safe to call unconditionally on every route
// (admin pages benefit from the same shell-caching too, harmlessly - see
// vite.config.ts's own comment on why route-scoping the WORKER itself
// isn't the right mechanism); only the decision to actually reload on an
// available update is confined to RemoteRefreshWatcher's own
// display-route gate.
export function registerServiceWorkerUpdates(): void {
  if (!('serviceWorker' in navigator)) return

  applyUpdateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateAvailable = true
    },
    onRegisteredSW(swUrl, registration) {
      if (!registration) return
      window.setInterval(async () => {
        // Mid-install already, or genuinely offline - nothing useful to
        // check right now, try again next interval rather than erroring.
        if (registration.installing || !navigator.onLine) return
        try {
          const response = await fetch(swUrl, {
            cache: 'no-store',
            headers: { cache: 'no-store', 'cache-control': 'no-cache' },
          })
          if (response.status === 200) await registration.update()
        } catch {
          // No connectivity right now - try again next interval, same
          // posture as every other network call in this app.
        }
      }, UPDATE_CHECK_INTERVAL_MS)
    },
  })
}
