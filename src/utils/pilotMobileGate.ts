// Pure helpers for the Pilot's App's "Mobile Pilot View enabled" re-check
// (PilotViewPage.tsx). The app used to read tenants.mobile_enabled only once,
// on mount, so a tenant switched off (e.g. unpaid) kept a live app on every
// phone that already had it open - and one switched back on by Stripe stayed
// locked. PilotViewPage now re-reads it on its 60 s tick and when the app
// returns to the foreground.

// Foreground / extra checks never run more often than this. The 60 s tick is
// the base cadence and is not throttled by it.
export const MOBILE_CHECK_MIN_GAP_MS = 30_000

// What the gate becomes after a check. ONLY an explicit boolean in an OK config
// response changes it; a failed, offline, malformed or empty response keeps the
// current state, so a flaky connection can never lock (or unlock) anybody.
export function resolveMobileEnabled(current: boolean, config: unknown): boolean {
  if (config && typeof config === 'object') {
    const value = (config as { mobileEnabled?: unknown }).mobileEnabled
    if (typeof value === 'boolean') return value
  }
  return current
}

// true when no check has run yet, or the last one was at least minGapMs ago.
export function mobileCheckDue(nowMs: number, lastCheckMs: number | null, minGapMs: number = MOBILE_CHECK_MIN_GAP_MS): boolean {
  return lastCheckMs === null || nowMs - lastCheckMs >= minGapMs
}
