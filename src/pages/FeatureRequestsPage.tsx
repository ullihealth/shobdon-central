import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

type FeatureStatus = 'idea' | 'planned' | 'built' | 'parked'

interface FeatureRequest {
  id: string
  title: string
  description: string
  status: FeatureStatus
  submittedByOrgId: string
  submittedByTenantName: string | null
  createdAt: string
}

const STATUSES: FeatureStatus[] = ['idea', 'planned', 'built', 'parked']

const STATUS_LABELS: Record<FeatureStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  built: 'Built',
  parked: 'Parked',
}

const STATUS_STYLES: Record<FeatureStatus, string> = {
  idea: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  planned: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  built: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  parked: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function StatusBadge({ status }: { status: FeatureStatus }): JSX.Element {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function FeatureRequestsPage(): JSX.Element {
  const [requests, setRequests] = useState<FeatureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Independent /api/tenant/me fetch, same convention as DesignPage.tsx's
  // own cafeEntitled check - drives whether the status <select> below is
  // editable at all. Fails closed (false) until resolved, so a regular
  // tenant admin never sees an editable control flash before this
  // resolves.
  const [isDeveloper, setIsDeveloper] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  function loadRequests() {
    setLoading(true)
    fetch('/api/tenant/feature-requests')
      .then((response) => (response.ok ? response.json() : { requests: [] }))
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadRequests()
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsDeveloper(!!data?.isDeveloper))
      .catch(() => {})
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/tenant/feature-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Failed to submit feature request')
        return
      }
      setTitle('')
      setDescription('')
      loadRequests()
    } catch {
      setError('Failed to submit feature request')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(request: FeatureRequest, status: FeatureStatus) {
    setUpdatingId(request.id)
    setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, status } : r)))
    const response = await fetch(`/api/tenant/feature-requests/${request.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      // Revert on failure - same "an optimistic toggle that silently
      // didn't persist would be worse than a visible failure" reasoning
      // as PlatformTenantsPage.tsx's own handleBooleanToggle.
      setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, status: request.status } : r)))
    }
    setUpdatingId(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16 pt-10">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-black uppercase tracking-wide text-primary">Feature Requests</h1>
        <Link to="/versions" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          Versions →
        </Link>
      </div>
      <p className="mb-8 max-w-2xl text-sm text-muted-400">
        A shared board across every Airfield Central tenant - suggest something, or see what other clubs have
        already asked for. Status is set by the Airfield Central team.
      </p>

      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Suggest a feature</div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Title</span>
            <input
              type="text"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Description</span>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm font-semibold text-status-bad">{error}</p>}
      </section>

      <section className="rounded-2xl border border-border bg-panel p-6">
        <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">All requests</div>
        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-400">No feature requests yet - be the first to suggest one.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((request) => (
              <div key={request.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-semibold text-white">{request.title}</div>
                    <p className="mt-1 text-sm text-muted-400">{request.description}</p>
                    <div className="mt-2 text-xs text-muted-500">
                      {request.submittedByTenantName ?? 'Unknown tenant'} · {formatDate(request.createdAt)}
                    </div>
                  </div>
                  {isDeveloper ? (
                    <select
                      value={request.status}
                      disabled={updatingId === request.id}
                      onChange={(event) => handleStatusChange(request, event.target.value as FeatureStatus)}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs font-semibold text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <StatusBadge status={request.status} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
