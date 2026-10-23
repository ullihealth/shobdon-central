// Client side of the "suspended tenant" back-office lock (the real lock is
// server-side: functions/api/_utils/tenantAuth.ts requireTenant returns 403
// {error: "Subscription not active"} for a suspended tenant's non-developer
// users on every /api/tenant/* route except a short allow-list). This only
// makes the admin UI say so clearly instead of showing pages that would 403.

// Exactly what the brief specifies for the banner / locked page.
export const SUBSCRIPTION_NOT_ACTIVE_MESSAGE =
  'Subscription not active. Your account is on hold — please activate your subscription to restore access.'

// The only admin page a locked user can open (everything else in the sidebar
// is greyed out and a direct link shows the message instead).
export const SUSPENDED_ALLOWED_PATHS: readonly string[] = ['/account']

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
