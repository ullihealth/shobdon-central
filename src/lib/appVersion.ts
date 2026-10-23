// Admin tabs always run the latest code.
//
// An admin tab can stay open for days; the app ships often. The build id baked
// into this bundle (__BUILD_ID__, vite.config.ts) is compared with the current
// one published, uncached, at /version.json (written by every build, so both the
// Pages build and the Worker deploy serve it). AdminLayout.tsx runs the check on
// tab focus / visibility and every 5 minutes and reloads at a safe moment
// (lib/unsavedWorkGuard.ts), at most once per new build id.
//
// WHY updating the service worker matters: the main app registers an app-shell
// precaching service worker (vite.config.ts VitePWA, registerType 'prompt'). Until
// a NEW worker takes over, every page load - even a full reload - is answered from
// the OLD precached shell. So "reload" alone would just serve the stale code again;
// activateLatestWorker() first installs and activates the new worker. (This module
// deliberately does not touch the dashboards' reload path - RemoteRefreshWatcher.tsx
// / services/serviceWorkerUpdate.ts - nor the Pilot's App's worker.)

export const CURRENT_BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000
const RELOADED_FOR_KEY = 'aic.reloadedForBuild'

// Latest published build id, or null when it cannot be read (offline, server error,
// dev server, malformed file): a failed check must do nothing.
export async function fetchLatestBuildId(timeoutMs = 5000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: controller.signal })
    window.clearTimeout(timer)
    if (!response.ok) return null
    const data: { buildId?: unknown } = await response.json()
    return typeof data.buildId === 'string' && data.buildId ? data.buildId : null
  } catch {
    return null
  }
}

// Should this tab reload for `latest`? Only when it is known, different from the
// running build, and this tab has not ALREADY reloaded for that id (so a stale
// shell that somehow survives a reload can never put the tab in a reload loop).
export function shouldReloadForBuild(current: string, latest: string | null, alreadyReloadedFor: string | null): boolean {
  if (!latest || current === 'dev') return false
  if (latest === current) return false
  return alreadyReloadedFor !== latest
}

export function getReloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY)
  } catch {
    return null
  }
}

export function markReloadedFor(buildId: string): void {
  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, buildId)
  } catch {
    // Storage unavailable: the page-level guard in AdminLayout still limits this to once per tab session.
  }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

// Installs and ACTIVATES the newest service worker (never reloads by itself), so
// the page load that follows is served from the new shell. Resolves true when a new
// worker took over, false when there was nothing to update or it did not finish in
// time (callers still reload - without a service worker the load goes to the
// network). Offline or a failed update changes nothing.
export async function activateLatestWorker(maxWaitMs = 10_000): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return false
    await registration.update().catch(() => {})
    const deadline = Date.now() + maxWaitMs
    // A worker that is still installing becomes `waiting` once its precache is ready.
    while (!registration.waiting && Date.now() < deadline) await sleep(250)
    const waiting = registration.waiting
    if (!waiting) return false
    const activated = new Promise<boolean>((resolve) => {
      if (waiting.state === 'activated') return resolve(true)
      waiting.addEventListener('statechange', () => {
        if (waiting.state === 'activated') resolve(true)
        if (waiting.state === 'redundant') resolve(false)
      })
    })
    waiting.postMessage({ type: 'SKIP_WAITING' })
    return await Promise.race([activated, sleep(6000).then(() => false)])
  } catch {
    return false
  }
}
