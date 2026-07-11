import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    // falls through to the same /config default as owner, not the
    // media-manager-only landing the e5aa79a deploy incorrectly gave it -
    // admin still has media-manager access too, just isn't defaulted
    // there anymore, matching owner's own behaviour (owner can already
    // reach /media-manager via the link on /config, never gets sent
    // there automatically either). Same timeout protection as sign-in
    // above, shorter and with no retry - worst case on a hang is landing
    // on /config instead of the exact right page, same graceful fallback
    // the existing .catch(() => null) already used for a genuine network
    // error, just now also covering a hang rather than only an outright
    // rejection.
    const me = await withTimeout(
      fetch('/api/tenant/me').then((response) => (response.ok ? response.json() : null)),
      5000
    ).catch(() => null)
    setSubmitting(false)
    const landingPage =
      me?.role === 'media' ? '/media-manager' : me?.role === 'atc' ? '/atc-control' : '/config'
    navigate(landingPage)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20"
      >
        <h1 className="mb-6 text-xl font-black uppercase tracking-wide text-primary">Sign in</h1>

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
