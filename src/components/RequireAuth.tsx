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
  // When true, requires the logged-in user's isDeveloper flag (also from
  // /api/tenant/me) to be true - a separate, cross-tenant column, NOT a
  // tenant role. /developertools uses this instead of requireRole
  // specifically because the real developer account currently also
  // holds 'owner' role at Shobdon, and a role-only check would let every
  // other owner/admin in too.
  requireDeveloper?: boolean
  // Set only on /design's route (the branding step of the onboarding
  // flow) and /onboarding/terms itself (which must not redirect to
  // itself). Every other authenticated route enforces the mandatory
  // terms/privacy gate below - "every tenant goes through this, no skip
  // option" - so this prop exists to name the two deliberate exceptions,
  // not as a general-purpose opt-out.
  skipTermsGate?: boolean
}

// Gate for the management pages - redirects to /login when there's no
// valid BetterAuth session. Uses the client's own useSession() hook,
// which calls the same /api/auth/get-session route already proven
// working at the phase-0 login checkpoint - not a separate, hand-rolled
// check. Deliberately NOT used on the public dashboard route ("/") -
// that must stay unauthenticated for everyone.
export default function RequireAuth({ children, requireRole, requireDeveloper, skipTermsGate }: RequireAuthProps): JSX.Element | null {
  const { data: session, isPending } = authClient.useSession()
  // Unconditional (not gated on requireRole/requireDeveloper being set) -
  // the mandatory terms/privacy gate below needs hasAcceptedTerms on
  // every authenticated route, including bare <RequireAuth> ones like
  // /account that previously never called /api/tenant/me at all.
  const [meCheck, setMeCheck] = useState<{ loading: boolean; role: string | null; isDeveloper: boolean; hasAcceptedTerms: boolean }>({
    loading: true,
    role: null,
    isDeveloper: false,
    hasAcceptedTerms: false,
  })

  useEffect(() => {
    if (!session) return
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setMeCheck({
            loading: false,
            role: data?.role ?? null,
            isDeveloper: !!data?.isDeveloper,
            hasAcceptedTerms: !!data?.hasAcceptedTerms,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setMeCheck({ loading: false, role: null, isDeveloper: false, hasAcceptedTerms: false })
      })
    return () => {
      cancelled = true
    }
  }, [session])

  if (isPending) return null
  if (!session) return <Navigate to="/login" replace />
  if (meCheck.loading) return null

  const allowedRoles = requireRole ? (Array.isArray(requireRole) ? requireRole : [requireRole]) : null
  const roleOk = !allowedRoles || (!!meCheck.role && allowedRoles.includes(meCheck.role as MemberRole))
  const developerOk = !requireDeveloper || meCheck.isDeveloper

  if (!roleOk || !developerOk) {
    // Safety net for anyone landing here via a stale link/bookmark:
    // meCheck.role is already fetched above for the access check
    // itself, so this reuses it rather than a second /api/tenant/me
    // call - only shown when we actually know a real, recognized role
    // to send them to, so this can't itself become a second dead end.
    const ownLandingPage =
      meCheck.role === 'atc'
        ? '/atc-control'
        : meCheck.role === 'media'
          ? '/media-manager'
          : meCheck.role === 'cafe'
            ? '/cafe-media'
            : meCheck.role === 'owner' || meCheck.role === 'admin'
              ? '/config'
              : null

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

  // Mandatory onboarding terms/privacy gate - "every tenant goes
  // through this, no skip option". requireDeveloper routes (/platform/
  // tenants, /developertools) are platform tooling, not "the tenant's
  // own dashboard", so they're excluded entirely. /design carries
  // skipTermsGate so the invite flow's branding step (which must
  // happen BEFORE this gate, per the spec's own ordering) stays
  // reachable; /onboarding/terms itself also carries it, since a page
  // can't gate on redirecting to itself.
  if (!requireDeveloper && !skipTermsGate && !meCheck.hasAcceptedTerms) {
    return <Navigate to="/onboarding/terms" replace />
  }

  return <>{children}</>
}
