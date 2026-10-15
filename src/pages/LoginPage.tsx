import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'

// Confirmed directly against production (2026-07-11): sign-in requests
// intermittently get NO response at all - not an error, not a rejected
// promise, just silence - roughly 1 in 3 attempts in a burst, verified
// via Cloudflare Pages Function logs showing zero server-side trace of
// the affected requests (they never reach the Function; this is an edge-
// level issue, not application code - confirmed no auth-related file
// changed in any recent deploy). Without a timeout, handleSubmit below
// would hang indefinitely on a bad attempt: submitting stays true
// forever, no error ever shows, and the only way out is reloading the
// page - which looks exactly like "bounced back to a blank login page"
// from the user's side. withTimeout+retry can't fix the underlying edge
// issue, but absorbs it: at a ~33% single-attempt failure rate, 3
// attempts drops the user-visible failure rate to roughly 1 in 27.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      }
    )
  })
}

// Only retries on timeout/thrown network errors, never on a real
// credential failure - authClient.signIn.email resolves normally with
// {error: signInError} for a wrong password, it doesn't throw, so that
// case returns immediately on the first attempt without wasting retries
// or looking like repeated failed login attempts.
async function signInWithRetry(
  email: string,
  password: string,
  maxAttempts = 3
): Promise<{ error?: { message?: string } | null }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await withTimeout(authClient.signIn.email({ email, password }), 8000)
    } catch {
      if (attempt === maxAttempts) {
        return { error: { message: 'Sign-in is taking longer than expected. Please check your connection and try again.' } }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 600))
    }
  }
  return { error: { message: 'Sign in failed' } }
}

// Post-payment landing round - polling constants for the "Activating
// your subscription…" state below. 3s * 20 = 60s total, matching the
// task's own "up to ~60s" budget - long enough to cover the webhook's
// normal checkout.session.completed -> entitlement latency (seconds,
// not minutes, per the sandbox round's own evidence) without leaving a
// genuinely stuck tenant staring at a spinner indefinitely.
const ACTIVATION_POLL_INTERVAL_MS = 3000
const ACTIVATION_POLL_MAX_ATTEMPTS = 20

// Dashboard-Manager-as-landing round: plain owner/admin now land on
// /media-manager, not /config - see dashboardLandingPage.ts's own
// comment for the full reasoning. No isDeveloper carve-out - the
// developer account enters a tenant's backend exactly like any other
// owner/admin, same destination.
function landingPageForMe(me: { role?: string | null; tenantType?: string | null } | null): string {
  return me?.role === 'media'
    ? '/media-manager'
    : me?.role === 'atc'
      ? '/atc-control'
      : me?.role === 'cafe'
        ? '/cafe-media'
        : me?.tenantType === 'venue_cafe'
          ? '/cafe-media'
          : '/media-manager'
}

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Post-payment landing round - checkout.ts's own success_url sets
  // both of these (see that file's own comment on why it can't just
  // land the visitor on an already-authenticated dashboard: the session
  // cookie set on airfieldcentral.com while filling in the signup form
  // doesn't carry to the new tenant's own subdomain, and this app
  // deliberately has no cross-subdomain cookie config - that's real
  // tenant isolation, not a gap to close). welcome=1 switches this page
  // into the post-payment copy/prefill/activation-poll below; any other
  // visit to /login (including one WITHOUT welcome=1, e.g. an existing
  // tenant's normal day-to-day login) is completely unaffected.
  const welcome = searchParams.get('welcome') === '1'
  const prefillEmail = searchParams.get('email') ?? ''
  const [email, setEmail] = useState(prefillEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 'idle' - the normal form. 'polling' - signed in, webhook hasn't
  // landed yet, showing "Activating your subscription…". 'timeout' - 60s
  // passed with no entitlement; a friendly dead end with support's own
  // email, not a silent infinite spinner.
  const [activationState, setActivationState] = useState<'idle' | 'polling' | 'timeout'>('idle')

  // Was left at index.html's own generic default (never a real bug per
  // se - the shared shell has no way to bake in a per-route title of its
  // own - but every other route either sets its own or, like this one,
  // was simply missed) - static since this page has no tenant/session
  // data of its own to include, unlike DashboardPage.tsx's dynamic
  // per-tenant title.
  useEffect(() => {
    document.title = 'Sign In — Airfield Central'
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await signInWithRetry(email, password)

    if (signInError) {
      setSubmitting(false)
      setError(signInError.message ?? 'Sign in failed')
      return
    }

    // media/atc-role members have no owner-only pages to land on -
    // /config would just show them "Not authorized" with no way forward,
    // so send each straight to the one page they can actually use. admin
    // is a full alias of owner (see requireOwner in tenantAuth.ts) so it
    // falls through to the exact same default landingPageForMe gives
    // owner, never a separately-maintained admin-specific branch - the
    // e5aa79a deploy once regressed exactly that (admin defaulted to
    // /media-manager while owner stayed on /config, two different
    // answers to "where's my home page"), fixed by making admin always
    // mirror owner rather than special-casing it again here. Dashboard-
    // Manager-as-landing round changed what that shared default IS
    // (/media-manager, not /config - see landingPageForMe's own
    // comment), not whether admin and owner still agree with each other
    // - they still do. Same timeout protection as sign-in
    // above, shorter and with no retry - worst case on a hang is `me`
    // staying null, which landingPageForMe's own final branch reads as
    // sending to /media-manager instead of the exact right page - same
    // graceful fallback the existing .catch(() => null) already used
    // for a genuine network error, just now also covering a hang rather
    // than only an outright rejection.
    const me = await withTimeout(
      fetch('/api/tenant/me').then((response) => (response.ok ? response.json() : null)),
      5000
    ).catch(() => null)

    // Post-payment landing round - a tenant that just paid but whose
    // webhook hasn't landed yet still reports subscriptionPending=true
    // here (same flag RequireAuth.tsx's own gate already reads - see
    // that file's own comment). Rather than navigate straight into
    // /config and let that gate immediately bounce them to
    // /complete-subscription's own "pay again" screen (wrong message -
    // they already paid), poll right here until it clears.
    if (me?.subscriptionPending) {
      setSubmitting(false)
      setActivationState('polling')
      for (let attempt = 1; attempt <= ACTIVATION_POLL_MAX_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, ACTIVATION_POLL_INTERVAL_MS))
        const polled = await fetch('/api/tenant/me')
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
        if (polled && !polled.subscriptionPending) {
          navigate(landingPageForMe(polled))
          return
        }
      }
      setActivationState('timeout')
      return
    }

    setSubmitting(false)
    navigate(landingPageForMe(me))
  }

  if (activationState === 'polling') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-center text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-primary">Activating your subscription…</h1>
          <p className="text-sm text-muted-400">This usually takes a few seconds. Please don&apos;t close this page.</p>
        </div>
      </div>
    )
  }

  if (activationState === 'timeout') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-center text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-primary">Still activating</h1>
          <p className="text-sm text-muted-400">
            Your payment went through, but your dashboard is taking longer than usual to activate. Please try
            reloading this page in a minute, or contact{' '}
            <a href="mailto:support@airfieldcentral.com" className="text-accent-sky-400 hover:underline">
              support@airfieldcentral.com
            </a>{' '}
            and we&apos;ll sort it out.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20"
      >
        <h1 className="mb-6 text-xl font-black uppercase tracking-wide text-primary">Sign in</h1>

        {welcome && (
          <p className="mb-6 rounded-lg border border-accent-sky-500/40 bg-accent-sky-500/10 p-3 text-sm text-slate-200">
            Welcome to Airfield Central — payment received. Log in to set up your dashboard.
          </p>
        )}

        <label className="mb-4 flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="mb-6 flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

        {error && <p className="mb-4 text-sm font-semibold text-status-bad">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
