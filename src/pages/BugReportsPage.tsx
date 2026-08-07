import { useEffect, useState } from 'react'

type BugStatus = 'reported' | 'working' | 'fixed' | 'parked'

interface BugReport {
  id: string
  title: string
  description: string
  status: BugStatus
  submittedByOrgId: string
  submittedByTenantName: string | null
  createdAt: string
}

const STATUSES: BugStatus[] = ['reported', 'working', 'fixed', 'parked']

const STATUS_LABELS: Record<BugStatus, string> = {
  reported: 'Reported',
  working: 'Working',
  fixed: 'Fixed',
  parked: 'Parked',
}

// Same colour values as FeatureRequestsPage.tsx's own STATUS_STYLES
// (reused, not reinvented, per instruction) - reported/working/fixed map
// to mid blue/amber/green, parked takes the same slate/grey.
const STATUS_STYLES: Record<BugStatus, string> = {
  reported: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  working: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  fixed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  parked: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function StatusBadge({ status }: { status: BugStatus }): JSX.Element {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default function BugReportsPage(): JSX.Element {
  const [reports, setReports] = useState<BugReport[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Independent /api/tenant/me fetch, same convention as
  // FeatureRequestsPage.tsx's own isDeveloper check - drives whether the
  // status <select> below is editable at all. Fails closed (false) until
  // resolved, so a regular tenant admin never sees an editable control
  // flash before this resolves.
  const [isDeveloper, setIsDeveloper] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  function loadReports() {
    setLoading(true)
    fetch('/api/tenant/bug-reports')
      .then((response) => (response.ok ? response.json() : { reports: [] }))
      .then((data) => setReports(data.reports ?? []))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadReports()
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
      const response = await fetch('/api/tenant/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Failed to submit bug report')
        return
      }
      setTitle('')
      setDescription('')
      loadReports()
    } catch {
      setError('Failed to submit bug report')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(report: BugReport, status: BugStatus) {
    setUpdatingId(report.id)
    setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status } : r)))
    const response = await fetch(`/api/tenant/bug-reports/${report.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      // Revert on failure - same "an optimistic toggle that silently
      // didn't persist would be worse than a visible failure" reasoning
      // as FeatureRequestsPage.tsx's own handleStatusChange.
      setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: report.status } : r)))
    }
    setUpdatingId(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16 pt-10">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Bug Reports</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-400">
        A shared board across every Airfield Central tenant - report a bug, or see what other clubs have already
        flagged. Status is set by the Airfield Central team.
      </p>

      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Report a bug</div>
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
            {submitting ? 'Submitting…' : 'Submit report'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm font-semibold text-status-bad">{error}</p>}
      </section>

      <section className="rounded-2xl border border-border bg-panel p-6">
        <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">All bug reports</div>
        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-400">No bug reports yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {reports.map((report) => (
              <div key={report.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-semibold text-white">{report.title}</div>
                    <p className="mt-1 text-sm text-muted-400">{report.description}</p>
                    <div className="mt-2 text-xs text-muted-500">
                      {report.submittedByTenantName ?? 'Unknown tenant'} · {formatDate(report.createdAt)}
                    </div>
                  </div>
                  {isDeveloper ? (
                    <select
                      value={report.status}
                      disabled={updatingId === report.id}
                      onChange={(event) => handleStatusChange(report, event.target.value as BugStatus)}
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold focus:border-sky-500 focus:outline-none disabled:opacity-50 ${STATUS_STYLES[report.status]}`}
                    >
                      {STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <StatusBadge status={report.status} />
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
