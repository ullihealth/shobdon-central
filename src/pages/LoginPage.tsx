import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'

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

    const { error: signInError } = await authClient.signIn.email({ email, password })

    if (signInError) {
      setSubmitting(false)
      setError(signInError.message ?? 'Sign in failed')
      return
    }

    // media/atc-role members have no owner-only pages to land on -
    // /config would just show them "Not authorized" with no way forward,
    // so send each straight to the one page they can actually use. Owner
    // keeps the existing /config default, unchanged.
    const me = await fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
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
