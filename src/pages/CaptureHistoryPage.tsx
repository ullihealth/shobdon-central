import { useEffect, useState } from 'react'

const CAPTURE_HISTORY_URL = '/api/platform/capture-history'

interface CaptureRow {
  observedAt: string
  windSpeedKt: number | null
  windDirDeg: number | null
  windGustKt: number | null
  qnhHpa: number | null
  qfeHpa: number | null
  tempC: number | null
  dewpointC: number | null
  visibilityM: number | null
  runway: string | null
  runwayHand: string | null
  sourceType: string
}

interface CaptureHistoryResponse {
  tenantId: number
  tenantName: string
  tenantSlug: string
  limit: number
  observations: CaptureRow[]
  observationsTotalCount: number
  snapshots: CaptureRow[]
  snapshotsTotalCount: number
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatNumber(value: number | null): string {
  return value === null || value === undefined ? '—' : String(value)
}

function CaptureTable({ rows }: { rows: CaptureRow[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-500">No rows.</p>
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-white/5 text-xs uppercase tracking-widest text-muted-500">
            <th className="px-4 py-2">Observed at</th>
            <th className="px-4 py-2">Wind (kt)</th>
            <th className="px-4 py-2">Dir (°)</th>
            <th className="px-4 py-2">Gust (kt)</th>
            <th className="px-4 py-2">QNH</th>
            <th className="px-4 py-2">QFE</th>
            <th className="px-4 py-2">Temp (°C)</th>
            <th className="px-4 py-2">Dewpoint</th>
            <th className="px-4 py-2">Vis (m)</th>
            <th className="px-4 py-2">Runway</th>
            <th className="px-4 py-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.observedAt} className="border-b border-border/60 text-xs text-muted-300 last:border-0">
              <td className="px-4 py-2 text-muted-100">{formatDate(row.observedAt)}</td>
              <td className="px-4 py-2">{formatNumber(row.windSpeedKt)}</td>
              <td className="px-4 py-2">{formatNumber(row.windDirDeg)}</td>
              <td className="px-4 py-2">{formatNumber(row.windGustKt)}</td>
              <td className="px-4 py-2">{formatNumber(row.qnhHpa)}</td>
              <td className="px-4 py-2">{formatNumber(row.qfeHpa)}</td>
              <td className="px-4 py-2">{formatNumber(row.tempC)}</td>
              <td className="px-4 py-2">{formatNumber(row.dewpointC)}</td>
              <td className="px-4 py-2">{formatNumber(row.visibilityM)}</td>
              <td className="px-4 py-2">{row.runway ? `${row.runway}${row.runwayHand ?? ''}` : '—'}</td>
              <td className="px-4 py-2 text-muted-500">{row.sourceType}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Weather capture retention round: raw list view of both retention
// tables (24h full-resolution weather_observations, 12-month downsampled
// weather_snapshots_15min) - a diagnostic to confirm the capture worker's
// cron (runSnapshotAndTrimJob) is actually snapshotting and trimming as
// designed, not a reporting/charting tool. Charts can come later once
// there's enough real 15-min history to make one worth building.
export default function CaptureHistoryPage(): JSX.Element {
  useEffect(() => {
    document.title = 'Capture History — Airfield Central'
  }, [])

  const [data, setData] = useState<CaptureHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(CAPTURE_HISTORY_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((json) => {
        if (json) setData(json)
      })
      .finally(() => setLoading(false))
  }, [])

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
      <div className="mx-auto max-w-[1400px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Capture History</h1>
        <p className="mb-6 max-w-3xl text-sm text-muted-400">
          Raw retention data for {data ? `${data.tenantName} (${data.tenantSlug})` : 'the default tenant'} - full-resolution
          captures (rolling 24h) and 15-minute downsampled snapshots (rolling 12 months). No charts yet - this is for
          confirming the retention cron is actually snapshotting and trimming as designed.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : !data ? (
          <p className="text-sm text-status-bad">Failed to load capture history.</p>
        ) : (
          <div className="space-y-10">
            <section>
              <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">
                Full-resolution captures (24h)
                <span className="ml-2 text-xs font-normal normal-case text-muted-500">
                  showing {data.observations.length} of {data.observationsTotalCount}
                </span>
              </h2>
              <CaptureTable rows={data.observations} />
            </section>

            <section>
              <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">
                15-minute snapshots (12 months)
                <span className="ml-2 text-xs font-normal normal-case text-muted-500">
                  showing {data.snapshots.length} of {data.snapshotsTotalCount}
                </span>
              </h2>
              <CaptureTable rows={data.snapshots} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
