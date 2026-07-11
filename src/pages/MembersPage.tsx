import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MemberRole, TenantMember } from '../types/member'

const ADDABLE_ROLES: MemberRole[] = ['admin', 'atc', 'media']

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MembersPage(): JSX.Element {
  const [members, setMembers] = useState<TenantMember[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('admin')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One-time reveal - the temporary password is only ever known at the
  // moment it's generated (add or reset), never fetchable again after.
  const [revealedPassword, setRevealedPassword] = useState<{ email: string; password: string } | null>(null)

  function loadMembers() {
    setLoading(true)
    fetch('/api/tenant/members')
      .then((response) => (response.ok ? response.json() : { members: [] }))
      .then((data) => setMembers(data.members ?? []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadMembers()
  }, [])

  async function handleAddMember(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setRevealedPassword(null)

    try {
      const response = await fetch('/api/tenant/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Failed to add member')
        return
      }
      if (data.temporaryPassword) {
        setRevealedPassword({ email: data.email, password: data.temporaryPassword })
      }
      setEmail('')
      loadMembers()
    } catch {
      setError('Failed to add member')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(member: TenantMember) {
    if (!window.confirm(`Remove ${member.email}'s access? This takes effect immediately.`)) return
    const response = await fetch(`/api/tenant/members/${member.id}`, { method: 'DELETE' })
    if (response.ok) loadMembers()
  }

  async function handleResetPassword(member: TenantMember) {
    if (!window.confirm(`Generate a new temporary password for ${member.email}? Their current password stops working immediately.`)) {
      return
    }
    const response = await fetch(`/api/tenant/members/${member.id}/reset-password`, { method: 'POST' })
    const data = await response.json()
    if (response.ok) setRevealedPassword({ email: member.email, password: data.temporaryPassword })
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
          ← Back to Config
        </Link>
        <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">Members</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Add or remove admin, ATC, and media accounts for this tenant. Admin has full owner-level access
          (including this page) plus Media Manager. ATC lands on ATC Control after login; media lands on Media
          Manager. Owner accounts aren't managed here.
        </p>

        {revealedPassword && (
          <div className="mb-6 rounded-2xl border border-accent-sky-500 bg-panel p-5">
            <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
              Temporary password for {revealedPassword.email}
            </div>
            <div className="mb-2 font-mono text-2xl text-white">{revealedPassword.password}</div>
            <p className="text-xs text-status-bad">
              Copy this now — it won't be shown again. Share it with them directly (not email/chat, if you can
              help it).
            </p>
            <button
              type="button"
              onClick={() => setRevealedPassword(null)}
              className="mt-3 text-xs font-semibold text-muted-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Add a member</div>
          <form onSubmit={handleAddMember} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-1 min-w-[200px] flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as MemberRole)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {ADDABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add member'}
            </button>
          </form>
          {error && <p className="mt-3 text-sm font-semibold text-status-bad">{error}</p>}
        </section>

        <section className="rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Current members</div>
          {loading ? (
            <p className="text-sm text-muted-400">Loading…</p>
          ) : (
            <div className="flex flex-col gap-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-white">{member.email}</div>
                    <div className="text-xs text-muted-500">
                      {member.role} · joined {formatDate(member.createdAt)}
                    </div>
                  </div>
                  {member.role !== 'owner' && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => handleResetPassword(member)}
                        className="text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(member)}
                        className="text-xs font-semibold text-status-bad"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
