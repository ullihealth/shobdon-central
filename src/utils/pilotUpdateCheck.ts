// "Is a new Pilot's App version waiting?" check that pull-to-refresh runs in
// addition to the check the app already makes on open and every 6 hours
// (usePilotServiceWorker.ts). Same underlying call - registration.update() -
// so it can only ever do what those checks already do: ask the browser to
// re-fetch pilot-sw.js and, if its bytes differ, install the new worker into
// `waiting`, which is exactly what makes the existing "Update available - tap
// to refresh" banner appear.
//
// Deliberately NOT able to update anything itself: this file never activates a
// worker (no SKIP_WAITING message), never reloads the page, and never touches
// the banner. The tap on the banner stays the only way the Pilot's App
// updates. A check that fails (offline, server error) is swallowed - pull-to-
// refresh's data refresh must carry on exactly as it did before.

// At most one pull-triggered check per this long, so pulling repeatedly can't
// hammer the server.
export const MIN_UPDATE_CHECK_INTERVAL_MS = 30_000

export interface UpdatableRegistration {
  update: () => Promise<unknown> | unknown
}

export interface UpdateChecker {
  // Runs the check unless one already ran within the minimum interval (or
  // there is no registration yet). Returns true only if it actually ran.
  // Never throws and never rejects.
  check: () => boolean
  // Records that a check just happened elsewhere (the on-open or 6-hourly one),
  // so a pull straight afterwards doesn't repeat it.
  noteCheck: () => void
}

export function createUpdateChecker(options: {
  getRegistration: () => UpdatableRegistration | null | undefined
  minIntervalMs?: number
  now?: () => number
}): UpdateChecker {
  const { getRegistration, minIntervalMs = MIN_UPDATE_CHECK_INTERVAL_MS, now = Date.now } = options
  let lastCheckAt: number | null = null

  return {
    check() {
      const registration = getRegistration()
      if (!registration) return false
      const current = now()
      if (lastCheckAt !== null && current - lastCheckAt < minIntervalMs) return false
      lastCheckAt = current
      try {
        // Handles both a rejected promise and a plain return value.
        void Promise.resolve(registration.update()).catch(() => {})
      } catch {
        // A synchronous throw must not break pull-to-refresh either.
      }
      return true
    },
    noteCheck() {
      lastCheckAt = now()
    },
  }
}
