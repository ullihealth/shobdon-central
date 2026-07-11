import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authClient } from '../lib/auth/authClient'

const MIN_PASSWORD_LENGTH = 8

export default function AccountPage(): JSX.Element {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match")
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }

    setSubmitting(true)
    // revokeOtherSessions: false - a user changing their own password from
    // an already-open session shouldn't be signed out of it; this only
    // protects against someone else silently taking over the account
    // going forward (they'd need the OLD password to have gotten in, and
    // the new one to stay in past this point).
    const { error: changeError } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: false,
    })
    setSubmitting(false)

    if (changeError) {
      setError(changeError.message ?? 'Current password is incorrect')
      return
    }

    setSuccess(true)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function handleLogout() {
    setLoggingOut(true)
    await authClient.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-xl px-5 pb-16 pt-8">
        <Link to="/" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
          ← Back to Dashboard
        </Link>
        <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">My Account</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Change your own password, or log out of this device.
        </p>

        <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Change password</div>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Current password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">New password</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Confirm new password</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            {error && <p className="text-sm font-semibold text-status-bad">{error}</p>}
            {success && <p className="text-sm font-semibold text-status-good">Password changed successfully.</p>}
            <button
              type="submit"
              disabled={submitting}
              className="mt-2 self-start rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {submitting ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-panel p-6">
          <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Log out</div>
          <p className="mb-4 text-sm text-muted-400">
            Ends your session on this device. Use this before leaving a shared computer.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="rounded-lg border border-status-bad px-4 py-2 text-sm font-bold uppercase tracking-widest text-status-bad transition hover:bg-status-bad hover:text-white disabled:opacity-50"
          >
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </section>
      </div>
    </div>
  )
}
