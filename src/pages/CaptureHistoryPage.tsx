import { useEffect, useState } from 'react'

const CAPTURE_HISTORY_URL = '/api/platform/capture-history'
const CHART_URL = '/api/platform/capture-history/chart'

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

// ---- Charts tab ----------------------------------------------------

type ChartRange = 'day' | 'week' | 'month' | 'year' | 'custom'
type BucketUnit = '15min' | 'hour' | 'day' | 'week'

interface ChartBucket {
  bucket: string
  hasCapture: boolean
  captureCount: number
  tempMin: number | null
  tempMax: number | null
  windMin: number | null
  windMax: number | null
  gustMax: number | null
}

interface ChartResponse {
  tenantId: number
  tenantName: string
  tenantSlug: string
  range: ChartRange
  bucketUnit: BucketUnit
  source: string
  start: string
  end: string
  buckets: ChartBucket[]
}

const RANGE_OPTIONS: { id: ChartRange; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'custom', label: 'Custom' },
]

function formatBucketLabel(iso: string, unit: BucketUnit): string {
  const d = new Date(iso)
  if (unit === '15min' || unit === 'hour') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Presence/absence only, per bucket - green if at least one capture row
// landed in that window, red if none. Deliberately not a value chart:
// this is the fastest way to spot a real outage (station down, capture
// worker not running) at a glance across a whole range.
function UptimeStrip({ buckets, bucketUnit }: { buckets: ChartBucket[]; bucketUnit: BucketUnit }): JSX.Element {
  return (
    <div className="flex h-8 w-full gap-px overflow-hidden rounded-lg border border-border">
      {buckets.map((b) => (
        <div
          key={b.bucket}
          title={`${formatBucketLabel(b.bucket, bucketUnit)} — ${b.hasCapture ? `${b.captureCount} capture${b.captureCount === 1 ? '' : 's'}` : 'no captures'}`}
          className={`flex-1 ${b.hasCapture ? 'bg-status-good' : 'bg-status-bad'}`}
        />
      ))}
    </div>
  )
}

const CHART_HEIGHT_PX = 160

// Shared min/max-per-bucket range chart, reused for both temperature and
// wind - a thin vertical bar spanning [min, max] observed within that
// bucket. markerKey is optional and renders as a single thin tick rather
// than a range (used for wind gust, which - confirmed against real
// production data before building this - is populated on only ~1-8% of
// rows, so a fully-fledged third range series would be mostly empty;
// an occasional marker is the honest representation of how sparse it is).
function RangeBarChart({
  buckets,
  bucketUnit,
  minKey,
  maxKey,
  markerKey,
  unitSuffix,
  barColorClass,
  markerColorClass,
  emptyMessage,
}: {
  buckets: ChartBucket[]
  bucketUnit: BucketUnit
  minKey: 'tempMin' | 'windMin'
  maxKey: 'tempMax' | 'windMax'
  markerKey?: 'gustMax'
  unitSuffix: string
  barColorClass: string
  markerColorClass?: string
  emptyMessage: string
}): JSX.Element {
  const values: number[] = []
  for (const b of buckets) {
    if (b[minKey] != null) values.push(b[minKey] as number)
    if (b[maxKey] != null) values.push(b[maxKey] as number)
    if (markerKey && b[markerKey] != null) values.push(b[markerKey] as number)
  }

  if (values.length === 0) {
    return <p className="text-sm text-muted-500">{emptyMessage}</p>
  }

  let scaleMin = Math.min(...values)
  let scaleMax = Math.max(...values)
  if (scaleMin === scaleMax) {
    scaleMin -= 1
    scaleMax += 1
  }
  // Headroom so a bar sitting exactly at the range's own min/max doesn't
  // visually clip against the chart's top/bottom edge.
  const padding = (scaleMax - scaleMin) * 0.1
  scaleMin -= padding
  scaleMax += padding
  const span = scaleMax - scaleMin

  function toPct(value: number): number {
    return ((value - scaleMin) / span) * 100
  }

  return (
    <div>
      <div className="relative rounded-lg border border-border bg-panel" style={{ height: CHART_HEIGHT_PX }}>
        <span className="absolute right-2 top-1 text-[10px] text-muted-500">
          {scaleMax.toFixed(1)}
          {unitSuffix}
        </span>
        <span className="absolute bottom-1 right-2 text-[10px] text-muted-500">
          {scaleMin.toFixed(1)}
          {unitSuffix}
        </span>
        <div className="flex h-full items-stretch gap-px px-1">
          {buckets.map((b) => {
            const min = b[minKey] as number | null
            const max = b[maxKey] as number | null
            const marker = markerKey ? (b[markerKey] as number | null) : null
            const hasRange = min != null && max != null
            return (
              <div
                key={b.bucket}
                className="relative h-full flex-1"
                title={`${formatBucketLabel(b.bucket, bucketUnit)}${hasRange ? ` — ${min}${unitSuffix} to ${max}${unitSuffix}` : ' — no data'}${marker != null ? `, gust ${marker}${unitSuffix}` : ''}`}
              >
                {hasRange && (
                  <div
                    className={`absolute w-full rounded-sm ${barColorClass}`}
                    style={{
                      bottom: `${toPct(min as number)}%`,
                      height: `${Math.max(2, toPct(max as number) - toPct(min as number))}%`,
                    }}
                  />
                )}
                {marker != null && (
                  <div
                    className={`absolute h-[2px] w-full ${markerColorClass ?? 'bg-amber-400'}`}
                    style={{ bottom: `${toPct(marker)}%` }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-500">
        <span>{formatBucketLabel(buckets[0].bucket, bucketUnit)}</span>
        <span>{formatBucketLabel(buckets[buckets.length - 1].bucket, bucketUnit)}</span>
      </div>
    </div>
  )
}

// datetime-local inputs give "YYYY-MM-DDTHH:mm" in the browser's LOCAL
// time with no timezone suffix - `new Date(...)` parses that as local
// time correctly, so converting to ISO here is just letting the Date
// object do the local->UTC conversion before it goes on the wire.
function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function ChartsView(): JSX.Element {
  const [range, setRange] = useState<ChartRange>('day')
  const [customStartInput, setCustomStartInput] = useState('')
  const [customEndInput, setCustomEndInput] = useState('')
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ start: string; end: string } | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)

  const [chartData, setChartData] = useState<ChartResponse | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)

  useEffect(() => {
    if (range === 'custom' && !appliedCustomRange) return

    setChartLoading(true)
    setChartError(null)

    const params = new URLSearchParams({ range })
    if (range === 'custom' && appliedCustomRange) {
      params.set('start', appliedCustomRange.start)
      params.set('end', appliedCustomRange.end)
    }

    fetch(`${CHART_URL}?${params.toString()}`)
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) throw new Error('Platform admin access required.')
        const json = await response.json().catch(() => null)
        if (!response.ok) throw new Error(json?.error ?? 'Failed to load chart data.')
        return json as ChartResponse
      })
      .then((json) => setChartData(json))
      .catch((err: Error) => setChartError(err.message))
      .finally(() => setChartLoading(false))
  }, [range, appliedCustomRange])

  function handleApplyCustomRange() {
    const startIso = localInputToIso(customStartInput)
    const endIso = localInputToIso(customEndInput)
    if (!startIso || !endIso) {
      setCustomError('Enter both a start and end date/time.')
      return
    }
    if (startIso >= endIso) {
      setCustomError('Start must be before end.')
      return
    }
    setCustomError(null)
    setAppliedCustomRange({ start: startIso, end: endIso })
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                range === opt.id ? 'bg-accent-sky-500 text-white' : 'border border-border text-muted-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {range === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-400">
              Start
              <input
                type="datetime-local"
                value={customStartInput}
                onChange={(e) => setCustomStartInput(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-400">
              End
              <input
                type="datetime-local"
                value={customEndInput}
                onChange={(e) => setCustomEndInput(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={handleApplyCustomRange}
              className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {customError && <p className="mb-4 text-sm text-status-bad">{customError}</p>}

      {range === 'custom' && !appliedCustomRange ? (
        <p className="text-sm text-muted-400">Pick a start and end date/time, then click Apply.</p>
      ) : chartLoading ? (
        <p className="text-sm text-muted-400">Loading…</p>
      ) : chartError ? (
        <p className="text-sm text-status-bad">{chartError}</p>
      ) : !chartData ? null : (
        <div className="space-y-10">
          <p className="text-xs text-muted-500">
            {chartData.buckets.length} buckets ({chartData.bucketUnit}) from {formatDate(chartData.start)} to {formatDate(chartData.end)} · source:{' '}
            {chartData.source === 'weather_observations' ? 'full-resolution captures' : '15-minute snapshots'}
          </p>

          <section>
            <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">Uptime</h2>
            <UptimeStrip buckets={chartData.buckets} bucketUnit={chartData.bucketUnit} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">Temperature (°C)</h2>
            <RangeBarChart
              buckets={chartData.buckets}
              bucketUnit={chartData.bucketUnit}
              minKey="tempMin"
              maxKey="tempMax"
              unitSuffix="°C"
              barColorClass="bg-accent-sky-500"
              emptyMessage="No temperature data in this range."
            />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">
              Wind (kt)
              <span className="ml-2 text-xs font-normal normal-case text-muted-500">amber tick = gust, where recorded</span>
            </h2>
            <RangeBarChart
              buckets={chartData.buckets}
              bucketUnit={chartData.bucketUnit}
              minKey="windMin"
              maxKey="windMax"
              markerKey="gustMax"
              unitSuffix="kt"
              barColorClass="bg-emerald-400"
              markerColorClass="bg-amber-400"
              emptyMessage="No wind data in this range."
            />
          </section>
        </div>
      )}
    </div>
  )
}

// ---- Page ------------------------------------------------------------

type Tab = 'observations' | 'snapshots' | 'charts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'observations', label: 'Full-Resolution (24H)' },
  { id: 'snapshots', label: '15-Minute Snapshots (12mo)' },
  { id: 'charts', label: 'Charts' },
]

// Weather capture retention round: raw list view of both retention
// tables (24h full-resolution weather_observations, 12-month downsampled
// weather_snapshots_15min), plus a Charts tab with server-aggregated
// uptime/temperature/wind views (functions/api/platform/capture-history/
// chart.ts does the bucketing in SQL - this page never buckets raw rows
// itself).
export default function CaptureHistoryPage(): JSX.Element {
  useEffect(() => {
    document.title = 'Capture History — Airfield Central'
  }, [])

  const [data, setData] = useState<CaptureHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  // Both raw tables arrive in the one fetch below, so switching between
  // those two tabs is a pure client-side render toggle - no refetch
  // needed. The Charts tab fetches separately (its own range-scoped
  // aggregation query), see ChartsView above.
  const [activeTab, setActiveTab] = useState<Tab>('observations')

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
          Retention data for {data ? `${data.tenantName} (${data.tenantSlug})` : 'the default tenant'} - full-resolution
          captures (rolling 24h), 15-minute downsampled snapshots (rolling 12 months), and range-scoped uptime/temperature/wind
          charts aggregated from both.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : !data ? (
          <p className="text-sm text-status-bad">Failed to load capture history.</p>
        ) : (
          <div>
            <div className="mb-6 flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                    activeTab === tab.id ? 'bg-accent-sky-500 text-white' : 'border border-border text-muted-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'observations' ? (
              <section>
                <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">
                  Full-resolution captures (24h)
                  <span className="ml-2 text-xs font-normal normal-case text-muted-500">
                    showing {data.observations.length} of {data.observationsTotalCount}
                  </span>
                </h2>
                <CaptureTable rows={data.observations} />
              </section>
            ) : activeTab === 'snapshots' ? (
              <section>
                <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-muted-100">
                  15-minute snapshots (12 months)
                  <span className="ml-2 text-xs font-normal normal-case text-muted-500">
                    showing {data.snapshots.length} of {data.snapshotsTotalCount}
                  </span>
                </h2>
                <CaptureTable rows={data.snapshots} />
              </section>
            ) : (
              <ChartsView />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
