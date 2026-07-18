import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'
import { onboardInviteAcceptUrl, onboardInviteValidateUrl } from '../config/publicApi'

type ValidateState = { status: 'loading' } | { status: 'invalid'; reason: string } | { status: 'valid'; tenantName: string }

const REASON_MESSAGES: Record<string, string> = {
  not_found: 'This invite link is not valid.',
  used: 'This invite link has already been used.',
  expired: 'This invite link has expired.',
}

// Public, unauthenticated: /onboard/:token - account setup step of the
// onboarding pipeline. On success, signs the new account in via
// authClient (real BetterAuth session, not a custom mechanism) and
// lands on /design (the branding step) - the mandatory terms gate
// (RequireAuth.tsx) then takes over from there on the next real
// navigation, since /design alone carries skipTermsGate.
export default function OnboardInvitePage(): JSX.Element {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [validate, setValidate] = useState<ValidateState>({ status: 'loading' })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetch(onboardInviteValidateUrl(token))
      .then((response) => (response.ok ? response.json() : { valid: false, reason: 'not_found' }))
      .then((data) => {
        if (cancelled) return
        setValidate(data.valid ? { status: 'valid', tenantName: data.tenantName ?? '' } : { status: 'invalid', reason: data.reason })
      })
      .catch(() => {
        if (!cancelled) setValidate({ status: 'invalid', reason: 'not_found' })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!token) return
    setSubmitting(true)
    setError(null)

    const response = await fetch(onboardInviteAcceptUrl(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || undefined, email, password }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setSubmitting(false)
      setError(data?.error || 'Something went wrong - please try again')
      return
    }

    const { error: signInError } = await authClient.signIn.email({ email, password })
    setSubmitting(false)
    if (signInError) {
      setError('Account created, but automatic sign-in failed - please sign in manually.')
      navigate('/login')
      return
    }
    navigate('/design')
  }

  if (validate.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <p className="text-sm text-muted-400">Checking your invite link…</p>
      </div>
    )
  }

  if (validate.status === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Invite link unavailable</h1>
          <p className="text-sm text-muted-400">{REASON_MESSAGES[validate.reason] ?? REASON_MESSAGES.not_found}</p>
          <p className="mt-4 text-xs text-muted-500">Contact support@airfieldcentral.com for a new link.</p>
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
        <h1 className="mb-2 text-xl font-black uppercase tracking-wide text-primary">Set up your account</h1>
        <p className="mb-6 text-sm text-muted-400">Create your login to start setting up your tenant.</p>

        <label className="mb-4 flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Your name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
          <span className="text-xs text-muted-500">At least 8 characters.</span>
        </label>

        {error && <p className="mb-4 text-sm font-semibold text-status-bad">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
