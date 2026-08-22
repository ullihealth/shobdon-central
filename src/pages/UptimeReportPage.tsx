import { useEffect, useMemo, useState } from 'react'

const KNOWN_DEVICES_URL = '/api/platform/known-devices'
const UPTIME_REPORT_URL = '/api/platform/uptime-report'

interface KnownDevice {
  tenantId: number
  tenantName: string
  tenantSlug: string
  displaySlug: string
  status: string
  active: number
}

interface Gap {
  start: string
  end: string
  durationMinutes: number
}

interface UptimeReport {
  tenantId: number
  tenantName: string
  tenantSlug: string
  displaySlug: string
  from: string
  to: string
  knownIpsUsed?: string[]
  expectedIntervalMinutes?: number
  expectedHeartbeats?: number
  actualHeartbeats?: number
  uptimePercent?: number
  gaps?: Gap[]
  error?: string
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

// Phase C - the audit artifact: for a tenant+display+date-range, using
// only visits from that tenant+display's confirmed known devices
// (Phase B), compute expected vs. actual heartbeats and a gap list.
// This is what Jeff pulls to verify or dispute advertiser billing, so
// it deliberately shows its own inputs (which IPs it counted, what
// interval it assumed) rather than just a bare percentage - a number
// with no visible basis isn't something you can defend in a dispute.
export default function UptimeReportPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Uptime Report — Airfield Central'
  }, [])

  const [knownDevices, setKnownDevices] = useState<KnownDevice[]>([])
  const [tenantSlug, setTenantSlug] = useState('')
  const [displaySlug, setDisplaySlug] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [report, setReport] = useState<UptimeReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch(KNOWN_DEVICES_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) setKnownDevices((data.knownDevices ?? []).filter((d: KnownDevice) => d.status === 'confirmed' && d.active === 1))
      })
  }, [])

  const tenantOptions = useMemo(() => {
    const map = new Map<string, { id: number; name: string }>()
    for (const d of knownDevices) map.set(d.tenantSlug, { id: d.tenantId, name: d.tenantName })
    return Array.from(map.entries()).map(([slug, v]) => ({ slug, ...v }))
  }, [knownDevices])

  const displayOptions = useMemo(
    () => Array.from(new Set(knownDevices.filter((d) => d.tenantSlug === tenantSlug).map((d) => d.displaySlug))),
    [knownDevices, tenantSlug]
  )

  const selectedTenantId = tenantOptions.find((t) => t.slug === tenantSlug)?.id

  async function handleRunReport() {
    if (!selectedTenantId || !displaySlug || !dateFrom || !dateTo) return
    setLoading(true)
    setReport(null)
    try {
      const params = new URLSearchParams({
        tenantId: String(selectedTenantId),
        displaySlug,
        from: dateFrom,
        to: dateTo,
      })
      const response = await fetch(`${UPTIME_REPORT_URL}?${params.toString()}`)
      const data = await response.json()
      setReport(data)
    } finally {
      setLoading(false)
    }
  }

  function handleExportCsv() {
    if (!selectedTenantId || !displaySlug || !dateFrom || !dateTo) return
    const params = new URLSearchParams({
      tenantId: String(selectedTenantId),
      displaySlug,
      from: dateFrom,
      to: dateTo,
      format: 'csv',
    })
    window.location.href = `${UPTIME_REPORT_URL}?${params.toString()}`
  }

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

  const canRun = !!selectedTenantId && !!displaySlug && !!dateFrom && !!dateTo

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-[1400px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Uptime Report</h1>
        <p className="mb-6 max-w-3xl text-sm text-muted-400">
          Uptime is computed only from visits matching a tenant+display's confirmed known device(s) (see{' '}
          <a href="/platform/known-devices" className="text-accent-sky-400 hover:underline">
            Known Devices
          </a>
          ) - a tenant/display with nothing confirmed yet can't produce a report. Expected heartbeats assume the
          real ~30-minute logged cadence (matches the display's own heartbeat interval directly - every ping now
          writes its own row), and this number can understate real uptime whenever a confirmed IP has quietly
          rotated away without being reconfirmed - see the reliability note on Known Devices.
        </p>

        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            Tenant
            <select
              value={tenantSlug}
              onChange={(e) => {
                setTenantSlug(e.target.value)
                setDisplaySlug('')
              }}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="">Select tenant…</option>
              {tenantOptions.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            Display
            <select
              value={displaySlug}
              onChange={(e) => setDisplaySlug(e.target.value)}
              disabled={!tenantSlug}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">Select display…</option>
              {displayOptions.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={handleRunReport}
            disabled={!canRun || loading}
            className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400 disabled:opacity-40"
          >
            {loading ? 'Running…' : 'Run Report'}
          </button>
          {report && !report.error && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500"
            >
              Export CSV
            </button>
          )}
        </div>

        {report?.error && (
          <div className="rounded-xl border border-status-bad/40 bg-status-bad/10 p-4 text-sm text-status-bad">
            {report.error}
          </div>
        )}

        {report && !report.error && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-border bg-panel p-4">
                <div className="text-xs uppercase tracking-widest text-muted-500">Expected</div>
                <div className="text-2xl font-bold text-primary">{report.expectedHeartbeats}</div>
              </div>
              <div className="rounded-2xl border border-border bg-panel p-4">
                <div className="text-xs uppercase tracking-widest text-muted-500">Actual</div>
                <div className="text-2xl font-bold text-primary">{report.actualHeartbeats}</div>
              </div>
              <div className="rounded-2xl border border-border bg-panel p-4">
                <div className="text-xs uppercase tracking-widest text-muted-500">Uptime</div>
                <div
                  className={`text-2xl font-bold ${
                    (report.uptimePercent ?? 0) >= 95
                      ? 'text-emerald-400'
                      : (report.uptimePercent ?? 0) >= 80
                        ? 'text-amber-400'
                        : 'text-status-bad'
                  }`}
                >
                  {report.uptimePercent}%
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-panel p-4">
                <div className="text-xs uppercase tracking-widest text-muted-500">Known IP(s) used</div>
                <div className="text-xs text-muted-300">{report.knownIpsUsed?.join(', ')}</div>
              </div>
            </div>

            <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-accent-sky-400">
              Gaps ({report.gaps?.length ?? 0})
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                    <th className="px-4 py-3">Start</th>
                    <th className="px-4 py-3">End</th>
                    <th className="px-4 py-3">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.gaps ?? []).map((g, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 text-xs text-muted-400">{formatDateTime(g.start)}</td>
                      <td className="px-4 py-3 text-xs text-muted-400">{formatDateTime(g.end)}</td>
                      <td className="px-4 py-3 text-xs text-status-bad">{formatDuration(g.durationMinutes)}</td>
                    </tr>
                  ))}
                  {(report.gaps ?? []).length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-center text-sm text-muted-500" colSpan={3}>
                        No gaps over one missed interval - full coverage across this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
