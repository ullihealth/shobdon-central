import { isSubscriptionInactiveResponse } from '../utils/subscriptionLock'
import { installUnsavedWorkGuard, isTrackedWrite, noteWriteEnd, noteWriteStart } from './unsavedWorkGuard'

// Central handling of the two server answers that mean "this admin tab can't
// carry on": 401 (session revoked / expired - e.g. "Log everyone out", Suspend)
// and 403 {error: "Subscription not active"} (tenant suspended). Instead of every
// admin page showing half-loaded content, silent failures or an error toast,
// AdminLayout listens for these events and switches the whole app to the login
// page / the "subscription not active" page at once.
//
// Implemented as a thin wrapper around window.fetch, installed only while the
// authenticated admin app (AdminLayout) is mounted, looking ONLY at same-origin
// /api/tenant/* responses. It never changes a response: the original is returned
// untouched (the body is inspected on a clone), so pages behave exactly as before
// until the layout takes over.
export const SESSION_EXPIRED_EVENT = 'aic:session-expired'
export const SUBSCRIPTION_INACTIVE_EVENT = 'aic:subscription-inactive'

let installCount = 0
let originalFetch: typeof window.fetch | null = null
let uninstallUnsaved: (() => void) | null = null

function requestPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin ? url.pathname : null
  } catch {
    return null
  }
}

export function installAdminFetchGuard(): () => void {
  installCount += 1
  if (installCount === 1) {
    originalFetch = window.fetch.bind(window)
    uninstallUnsaved = installUnsavedWorkGuard()
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input)
      // Saves / uploads in flight make the tab "busy" for the new-version check
      // (lib/unsavedWorkGuard.ts); a successful one clears its "unsaved edits" flag.
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
      const tracked = !!path && isTrackedWrite(method, path)
      if (tracked) noteWriteStart()
      let response: Response
      try {
        response = await (originalFetch as typeof window.fetch)(input, init)
      } catch (error) {
        if (tracked) noteWriteEnd(false)
        throw error
      }
      if (tracked) noteWriteEnd(response.ok)
      if (path && path.startsWith('/api/tenant/')) {
        if (response.status === 401) {
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
        } else if (response.status === 403) {
          try {
            const body = await response.clone().json()
            if (isSubscriptionInactiveResponse(response.status, body)) window.dispatchEvent(new Event(SUBSCRIPTION_INACTIVE_EVENT))
          } catch {
            // Not JSON: an ordinary 403 (e.g. wrong role) - leave it to the page.
          }
        }
      }
      return response
    }
  }
  return () => {
    installCount -= 1
    if (installCount === 0 && originalFetch) {
      window.fetch = originalFetch
      originalFetch = null
      uninstallUnsaved?.()
      uninstallUnsaved = null
    }
  }
}
