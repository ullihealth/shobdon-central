import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'
import type { MemberRole } from '../types/member'

interface RequireAuthProps {
  children: ReactNode
  // When set, requires the logged-in user's tenant role to be this exact
  // role, or (when given an array) one of several allowed roles - e.g.
  // /media-manager needs ['owner', 'admin', 'media']. Checked via GET
  // /api/tenant/me - not just "is a member of the tenant". A logged-in
  // user with a disallowed role gets a clear "not authorized" state, not
  // a redirect to /login (they ARE authenticated - redirecting them back
  // to a login form would be confusing and wrong) and not a broken/blank
  // page.
  requireRole?: MemberRole | MemberRole[]
}

// Gate for the management pages - redirects to /login when there's no
// valid BetterAuth session. Uses the client's own useSession() hook,
// which calls the same /api/auth/get-session route already proven
// working at the phase-0 login checkpoint - not a separate, hand-rolled
// check. Deliberately NOT used on the public dashboard route ("/") -
// that must stay unauthenticated for everyone.
export default function RequireAuth({ children, requireRole }: RequireAuthProps): JSX.Element | null {
  const { data: session, isPending } = authClient.useSession()
  const [roleCheck, setRoleCheck] = useState<{ loading: boolean; role: string | null }>({
    loading: !!requireRole,
    role: null,
  })

  useEffect(() => {
    if (!requireRole || !session) return
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setRoleCheck({ loading: false, role: data?.role ?? null })
      })
      .catch(() => {
        if (!cancelled) setRoleCheck({ loading: false, role: null })
      })
    return () => {
      cancelled = true
    }
  }, [requireRole, session])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />

  if (requireRole) {
    if (roleCheck.loading) return null
    const allowedRoles = Array.isArray(requireRole) ? requireRole : [requireRole]
    if (!roleCheck.role || !allowedRoles.includes(roleCheck.role as MemberRole)) {
      // Safety net for anyone landing here via a stale link/bookmark:
      // roleCheck.role is already fetched above for the access check
      // itself, so this reuses it rather than a second /api/tenant/me
      // call - only shown when we actually know a real, recognized role
      // to send them to, so this can't itself become a second dead end.
      const ownLandingPage =
        roleCheck.role === 'atc' ? '/atc-control' : roleCheck.role === 'media' ? '/media-manager' : roleCheck.role === 'owner' || roleCheck.role === 'admin' ? '/config' : null

      return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
            <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
            <p className="mb-6 text-sm text-muted-400">
              Your account doesn't have access to this page. If you think this is wrong, ask your tenant's owner.
            </p>
            {ownLandingPage && (
              <Link
                to={ownLandingPage}
                className="mb-3 block text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500"
              >
                → Go to your page
              </Link>
            )}
            <Link to="/" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
              ← Back to dashboard
            </Link>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}
