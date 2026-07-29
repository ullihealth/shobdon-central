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
  // Migration 0055 - Cloudflare-native geolocation, captured going
  // forward only. NULL on every row logged before that migration; no
  // backfill exists or is planned (see the migration's own comment).
  geoCountry: string | null
  geoRegion: string | null
  geoCity: string | null
  geoLatitude: string | null
  geoLongitude: string | null
}

// "Leominster, Herefordshire, GB" - city/region are frequently absent
// even when country is present (Cloudflare's own geolocation coverage
// varies by request), so each part is included only if actually set,
// rather than rendering literal "null" or leaving stray ", " gaps.
function formatGeoSummary(visit: Visit): string | null {
  const parts = [visit.geoCity, visit.geoRegion, visit.geoCountry].filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(', ') : null
}

type SortField = 'visitedAt' | 'ipAddress'
type SortDirection = 'asc' | 'desc'

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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('visitedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null)

  // Tenant slug -> id, accumulated (never shrunk) across every response
  // this page has seen so far - needed because tenantFilter is a slug
  // (readable in the URL-less UI, matches how the display-slug filter
  // already works) but the server-side filter takes tenant_id. Built up
  // rather than fetched from a dedicated tenants endpoint so this page
  // still works with zero extra requests on the common case (no filter
  // picked yet).
  const [knownTenants, setKnownTenants] = useState<Map<string, { id: number; name: string }>>(new Map())
  const [knownSlugs, setKnownSlugs] = useState<Set<string>>(new Set())

  // Total display_visits is 5,021 rows in production (Shobdon alone:
  // 4,993) - the backing endpoint caps a single response at 500 (see its
  // own MAX_ROWS comment), so an unfiltered fetch only ever shows a thin
  // recent slice. Tenant/display/date-range filters are sent to the
  // server (not applied client-side against that slice) specifically so
  // narrowing actually reaches rows outside that window, rather than
  // just re-filtering what a first, unfiltered load happened to return.
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    const tenantId = tenantFilter ? knownTenants.get(tenantFilter)?.id : undefined
    if (tenantId !== undefined) params.set('tenantId', String(tenantId))
    if (slugFilter) params.set('slug', slugFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    const query = params.toString()

    fetch(query ? `${VISITS_URL}?${query}` : VISITS_URL)
      .then((response) => {
        if (response.status === 403 || response.status === 401) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (!data) return
        const rows: Visit[] = data.visits ?? []
        setVisits(rows)
        setKnownTenants((prev) => {
          const next = new Map(prev)
          for (const v of rows) next.set(v.tenantSlug, { id: v.tenantId, name: v.tenantName })
          return next
        })
        setKnownSlugs((prev) => {
          const next = new Set(prev)
          for (const v of rows) next.add(v.displaySlug)
          return next
        })
      })
      .finally(() => setLoading(false))
    // tenantFilter's server-side lookup depends on knownTenants, but
    // knownTenants is only ever added to (never removed from) by this
    // same effect's own responses, so including it here would refetch
    // on every response - it's read via a ref-like snapshot at call
    // time instead (the .get() above), deliberately left out of the
    // dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantFilter, slugFilter, dateFrom, dateTo])

  const tenantOptions = useMemo(() => Array.from(knownTenants.keys()).sort(), [knownTenants])
  const slugOptions = useMemo(() => Array.from(knownSlugs).sort(), [knownSlugs])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection(field === 'visitedAt' ? 'desc' : 'asc')
    }
  }

  // Sort is purely client-side over whatever the server just returned
  // (already the correctly-filtered set, up to MAX_ROWS) - re-ordering
  // an in-memory array needs no round trip.
  const filtered = useMemo(() => {
    const rows = [...visits]
    rows.sort((a, b) => {
      let result: number
      if (sortField === 'visitedAt') {
        result = a.visitedAt.localeCompare(b.visitedAt)
      } else {
        // Nulls last regardless of direction - an unknown IP shouldn't
        // visually dominate either end of a sorted list.
        if (a.ipAddress === null && b.ipAddress === null) result = 0
        else if (a.ipAddress === null) return 1
        else if (b.ipAddress === null) return -1
        else result = a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true })
      }
      return sortDirection === 'asc' ? result : -result
    })
    return rows
  }, [visits, sortField, sortDirection])

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
          <label className="flex items-center gap-2 text-xs text-muted-400">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-400">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
              className="text-xs text-accent-sky-400 hover:underline"
            >
              Clear dates
            </button>
          )}
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
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('visitedAt')}
                      className="flex items-center gap-1 uppercase tracking-widest hover:text-primary"
                    >
                      Time
                      {sortField === 'visitedAt' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Display</th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('ipAddress')}
                      className="flex items-center gap-1 uppercase tracking-widest hover:text-primary"
                    >
                      IP address
                      {sortField === 'ipAddress' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
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
                      {tenantFilter || slugFilter || dateFrom || dateTo
                        ? 'No visits match the current filters.'
                        : 'No visits logged yet.'}
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
