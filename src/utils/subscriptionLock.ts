// Client side of the "suspended tenant" lock (the real lock is server-side:
// functions/api/_utils/tenantAuth.ts requireTenant returns 403 {error:
// "Subscription not active"} for a suspended tenant's non-developer users on
// every /api/tenant/* route except a short allow-list). A locked user sees ONE
// full-page "Your subscription isn't active" screen (SubscriptionTakeover.tsx)
// instead of the admin app - no sidebar, no admin pages.

// Admin pages a locked user may still open (inside a minimal shell, no sidebar):
// My Account, and Billing (reached from the takeover). Anything else shows the
// takeover itself.
export const SUSPENDED_ALLOWED_PATHS: readonly string[] = ['/account', '/billing']

// Locked = the tenant is suspended (GET /api/tenant/me -> subscriptionActive
// false) AND the user is not a developer (developers must keep full access to
// manage and Resume the tenant). Anything missing/malformed = NOT locked: a
// failed or odd response must never lock anybody (the server decides anyway).
export function isAdminLocked(me: { subscriptionActive?: unknown; isDeveloper?: unknown } | null | undefined): boolean {
  if (!me) return false
  return me.subscriptionActive === false && me.isDeveloper !== true
}

export function isPathAllowedWhileLocked(pathname: string): boolean {
  return SUSPENDED_ALLOWED_PATHS.includes(pathname.replace(/\/+$/, '') || '/')
}

// A response that means "this tenant is suspended" (what every locked
// /api/tenant/* route returns) - the central fetch guard switches the app to
// the takeover the moment it sees one.
export function isSubscriptionInactiveResponse(status: number, body: unknown): boolean {
  return status === 403 && !!body && typeof body === 'object' && (body as { error?: unknown }).error === 'Subscription not active'
}
