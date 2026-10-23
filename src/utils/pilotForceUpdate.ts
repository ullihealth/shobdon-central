// Pure logic for the Pilot's App update system (see README "Pilot's App
// updates"): the developer "Force Pilot App update" flag, the once-only reload
// guard, the auto-update cooldown, and the forced-update sequence itself.
// Everything here is injectable so it can be tested without a browser.

// The per-tenant KV key the capture Worker stores the force timestamp under is
// `refresh-requested:<tenant param>`; the Pilot's App uses tenant param
// `pilot:<slug>` - the SAME refresh-flag mechanism the dashboards use
// (RemoteRefreshWatcher.tsx), just a separate key so "Refresh displays" never
// touches /pilot and vice versa.
export function pilotForceTenantParam(slug: string): string {
  return `pilot:${slug}`
}

export type ForceVerdict = 'baseline' | 'force' | 'none'

export interface ForceWatcher {
  // Feed it the value of a SUCCESSFUL flag read (a timestamp, or null when no
  // force was ever requested). Failed reads must not be fed in at all.
  observe: (requestedAt: string | null) => ForceVerdict
  // The forced update could not run (offline, update() failed): let the same
  // request be retried on a later check.
  forgive: (requestedAt: string) => void
}

// Same idea as RemoteRefreshWatcher.tsx:
//  - the FIRST successful read is the existing state of the world (a force from
//    hours ago must not reload an app that just opened, and a freshly-reloaded
//    app must not see the request that reloaded it as new) -> 'baseline';
//  - a LATER read with a different, non-empty value is a new request -> 'force',
//    returned ONCE per value;
//  - the handled value is also persisted (storage), so even a baseline that was
//    delayed by a flaky network can never turn the request that caused a reload
//    into another reload (no reload loop).
export function createForceWatcher(options: {
  getHandled: () => string | null
  setHandled: (value: string | null) => void
}): ForceWatcher {
  let baselineTaken = false
  let lastSeen: string | null = null
  return {
    observe(requestedAt) {
      if (!baselineTaken) {
        baselineTaken = true
        lastSeen = requestedAt
        return 'baseline'
      }
      if (!requestedAt || requestedAt === lastSeen) return 'none'
      lastSeen = requestedAt
      if (options.getHandled() === requestedAt) return 'none'
      // Record BEFORE acting: the reload that follows must find it handled.
      options.setHandled(requestedAt)
      return 'force'
    },
    forgive(requestedAt) {
      if (options.getHandled() === requestedAt) options.setHandled(null)
      if (lastSeen === requestedAt) lastSeen = null
    },
  }
}

// Wraps a reload so that however many paths ask for it (controllerchange, the
// fallback timer, a plain reload), the page reloads AT MOST ONCE.
export function createReloadOnce(reload: () => void): () => boolean {
  let done = false
  return () => {
    if (done) return false
    done = true
    reload()
    return true
  }
}

// An auto-update after a release (AUTO_FORCE_UPDATE_ON_RELEASE) is allowed at
// most once per cooldown, so a service worker that somehow keeps reappearing in
// `waiting` can never put the app in a reload loop; it falls back to the
// "Update now" box instead.
export const AUTO_UPDATE_COOLDOWN_MS = 10 * 60 * 1000
export function autoUpdateAllowed(nowMs: number, lastAutoMs: number | null, cooldownMs: number = AUTO_UPDATE_COOLDOWN_MS): boolean {
  return lastAutoMs === null || nowMs - lastAutoMs >= cooldownMs
}

export const FORCE_FALLBACK_RELOAD_MS = 8_000

export interface ForceRegistration {
  update: () => Promise<unknown> | unknown
  waiting: { postMessage: (message: unknown) => void } | null
}

// The forced-update sequence: ask the browser for the newest service worker,
// activate a waiting one, then reload.
//  - offline, or registration.update() failing -> 'failed': NOTHING is reloaded
//    and the app is left exactly as it is (the caller hides the box);
//  - a waiting worker -> tell it SKIP_WAITING and let controllerchange reload
//    (via `reload`, which is once-only) - with a fallback timer in case the
//    event never arrives;
//  - nothing waiting (ordinary deploys leave pilot-sw.js unchanged) -> plain
//    reload: the worker is network-first, so the reload loads the latest build.
// No registration at all (no service-worker support) -> plain reload if online.
export async function runForcedUpdate(deps: {
  getRegistration: () => ForceRegistration | null
  isOnline: () => boolean
  reload: () => void // must be once-only (createReloadOnce)
  onActivating: () => void // marks that the next controllerchange is ours
  setTimer?: (fn: () => void, ms: number) => unknown
}): Promise<'reloading' | 'failed'> {
  if (!deps.isOnline()) return 'failed'
  const registration = deps.getRegistration()
  if (registration) {
    try {
      await Promise.resolve(registration.update())
    } catch {
      return 'failed'
    }
    const waiting = registration.waiting
    if (waiting) {
      deps.onActivating()
      waiting.postMessage({ type: 'SKIP_WAITING' })
      ;(deps.setTimer ?? ((fn: () => void, ms: number) => window.setTimeout(fn, ms)))(deps.reload, FORCE_FALLBACK_RELOAD_MS)
      return 'reloading'
    }
  }
  deps.reload()
  return 'reloading'
}
