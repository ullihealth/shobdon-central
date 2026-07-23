import { useEffect, useMemo, useState } from 'react'

const VISITS_URL = '/api/platform/visits'

interface Visit {
  id: number
  tenantId: number
  tenantName: string
  tenantSlug: string
  displaySlug: string
  visitedAt: string
  ipAddress: string | null
  userAgent: string | null
}

function formatVisitedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Backs the Platform Admin "Visit Log" nav entry - a plain,
// reverse-chronological view over display_visits (migration 0041), the
// per-visit log written by functions/api/public/heartbeat.ts each time a
// display page's heartbeat sees a new IP/user-agent or ~20 minutes have
// passed. Deliberately just a filterable list, no charts/aggregates -
// the questions this answers ("was this screen on around 9am", "what
// IPs have hit this URL lately") are both answered directly by scanning
// rows, not by a summary view.
export default function PlatformVisitsPage(): JSX.Element {
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [tenantFilter, setTenantFilter] = useState('')
  const [slugFilter, setSlugFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(VISITS_URL)
      .then((response) => {
        if (response.status === 403 || response.status === 401) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) setVisits(data.visits ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  // Client-side filtering over the already-fetched (server-capped,
  // see MAX_ROWS in the backing endpoint) set - re-fetching per
  // keystroke would be overkill for a list this size, and the tenant/
  // display dropdowns below are derived from the same fetched rows so
  // they only ever list values that actually appear in the log.
  const tenantOptions = useMemo(
    () => Array.from(new Set(visits.map((v) => v.tenantSlug))).sort(),
    [visits]
  )
  const slugOptions = useMemo(() => Array.from(new Set(visits.map((v) => v.displaySlug))).sort(), [visits])

  const filtered = visits.filter(
    (v) => (!tenantFilter || v.tenantSlug === tenantFilter) && (!slugFilter || v.displaySlug === slugFilter)
  )

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-[1900px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Visit Log</h1>
        <p className="mb-4 max-w-2xl text-sm text-muted-400">
          Every logged display visit, across every tenant. A row is written when a display's heartbeat sees a new IP
          or user-agent, or roughly every 20 minutes otherwise — not one row per heartbeat ping. Rows older than 30
          days are pruned automatically.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={tenantFilter}
            onChange={(event) => setTenantFilter(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All tenants</option>
            {tenantOptions.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
          <select
            value={slugFilter}
            onChange={(event) => setSlugFilter(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All displays</option>
            {slugOptions.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-500">
            {filtered.length} visit{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Display</th>
                  <th className="px-4 py-3">IP address</th>
                  <th className="px-4 py-3">User agent</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((visit) => (
                  <tr key={visit.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 text-xs text-muted-400">{formatVisitedAt(visit.visitedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{visit.tenantName}</div>
                      <div className="text-xs text-muted-500">{visit.tenantSlug}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-400">{visit.displaySlug}</td>
                    <td className="px-4 py-3 text-xs text-muted-400">{visit.ipAddress ?? '—'}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-xs text-muted-500" title={visit.userAgent ?? ''}>
                      {visit.userAgent ?? '—'}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-muted-500" colSpan={5}>
                      No visits logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
