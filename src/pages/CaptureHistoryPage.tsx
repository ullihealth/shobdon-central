import { useEffect, useRef, useState } from 'react'

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

// Mirrors chart.ts's own BUCKET_MS on the backend - needed here to turn
// a bucket's own start boundary into an END boundary for tooltip/
// duration math (a bucket's stored timestamp is always its START, e.g.
// a 15-min bucket "ends" 15 minutes after it starts).
const BUCKET_MS: Record<BucketUnit, number> = {
  '15min': 15 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
}

// Always date + time, regardless of bucket unit - unlike the axis tick
// labels (which stay brief and unit-aware, see formatAxisLabel below),
// a tooltip is only ever shown one at a time on demand, so there's no
// competing-for-space constraint that would justify trimming it down.
function formatTooltipDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// "19d 17h 26m" / "2h 5m" / "30m" - omits leading zero-value units
// (never "0d 2h 5m") but always keeps minutes, even when they're 0
// (e.g. "2h 0m"), so the string never looks truncated/cut off.
function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (days || hours) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

// Axis tick text: an hour-unit tick spanning a multi-day range (Week
// view) needs its date too, not just the time-of-day, or e.g. every
// daily tick would just
// read "00:00" with no way to tell which day. 15-min ticks stay
// time-only even when includeDate would technically apply, since a Day
// range is by construction never more than ~24h wide - see
// bucketUnitForSpan's mirror on the backend (chart.ts) for why.
function formatAxisLabel(iso: string, unit: BucketUnit, includeDate: boolean): string {
  const d = new Date(iso)
  if (unit === '15min') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  if (unit === 'hour') {
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    return includeDate ? `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}` : time
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function rangeSpansMultipleDays(startIso: string, endIso: string): boolean {
  return startIso.slice(0, 10) !== endIso.slice(0, 10)
}

// How many buckets apart consecutive axis labels should be, so a chart
// with a lot of bars doesn't try to label every single one and turn
// into unreadable overlapping text. Candidates are listed smallest-
// first per bucket unit; computeLabelStep below picks the smallest one
// that keeps the total label count under TARGET_MAX_LABELS for that
// unit - small bucket counts (e.g. a short Custom range) naturally fall
// through to step 1 (label every bucket) since even that already meets
// the target. Chosen per-unit rather than one global constant because
// longer label text (hour-unit ticks often need a date prefix, see
// formatAxisLabel) needs more horizontal room per label than a short
// time-only or date-only tick does.
const LABEL_STEP_CANDIDATES: Record<BucketUnit, number[]> = {
  '15min': [4, 8, 16, 24, 48, 96],
  hour: [6, 12, 24, 48, 72, 168],
  day: [1, 2, 3, 5, 7, 14, 30, 60, 90],
  week: [1, 2, 4, 8, 13, 26, 52],
}

const TARGET_MAX_LABELS: Record<BucketUnit, number> = {
  '15min': 24, // Day (~96 buckets) -> hourly labels
  hour: 14, // Week (~168 buckets) -> every ~12h
  day: 10, // Month (~30 buckets) -> every ~3rd day
  week: 13, // Year (~52 buckets) -> roughly monthly
}

function computeLabelStep(bucketCount: number, unit: BucketUnit): number {
  const candidates = LABEL_STEP_CANDIDATES[unit]
  const target = TARGET_MAX_LABELS[unit]
  for (const step of candidates) {
    if (Math.ceil(bucketCount / step) <= target) return step
  }
  return candidates[candidates.length - 1]
}

// Reserved on the LEFT of every chart's bar row, its axis-label row, AND
// the Uptime strip (which has no numeric y-axis of its own) - giving
// Uptime a matching blank gutter means all three charts' bars start at
// the identical x-offset, so they read as one aligned timeline rather
// than three independently-laid-out charts that happen to be stacked.
const Y_AXIS_GUTTER_PX = 34

// A floating, mouse-anchored info box - shared by the Uptime strip and
// both RangeBarChart instances (Temperature, Wind) via useChartTooltip
// below. Pinned to the top-center of whichever segment/bar was entered
// (computed once on mouseenter from that element's own bounding box,
// not tracked continuously on every mousemove) - simpler than cursor-
// following and reads fine for a chart make of adjacent equal-width
// bars, since the tooltip only ever needs to say "this bar/segment".
interface TooltipState {
  left: number
  top: number
  content: string
}

function TooltipOverlay({ tooltip }: { tooltip: TooltipState | null }): JSX.Element | null {
  if (!tooltip) return null
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-[240px] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-slate-950 px-2.5 py-1.5 text-[11px] leading-snug text-muted-100 shadow-lg"
      style={{ left: tooltip.left, top: tooltip.top - 6 }}
    >
      {tooltip.content}
    </div>
  )
}

// Shared by every chart below: a ref to the chart's own relatively-
// positioned container (tooltip coordinates are computed relative to
// it), plus show/hide handlers taking the hovered element itself
// (not raw mouse coordinates) so the tooltip anchors to that element's
// own position rather than the cursor's exact pixel.
function useChartTooltip() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  function show(el: HTMLElement, content: string) {
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (!containerRect) return
    const elRect = el.getBoundingClientRect()
    const rawLeft = elRect.left - containerRect.left + elRect.width / 2
    // Clamped so a bar/segment near either edge of the chart doesn't
    // push the tooltip (max-w-[240px], centered on rawLeft) out past
    // the chart's own bounds - 100px is a rough half-width estimate,
    // not a measurement of the actual rendered tooltip, but close
    // enough to keep it visually contained for the edge cases that
    // matter (the first/last couple of bars).
    const left = Math.min(Math.max(rawLeft, 100), containerRect.width - 100)
    setTooltip({ left, top: elRect.top - containerRect.top, content })
  }
  function hide() {
    setTooltip(null)
  }

  return { containerRef, tooltip, show, hide }
}

// Rendered once under EACH of the three charts (Uptime, Temperature,
// Wind) with the same buckets/bucketUnit/rangeStart/rangeEnd inputs, so
// all three always show identical tick spacing and identical labels for
// the same range - the whole point being that they read together as one
// timeline rather than three independently-labelled charts. A short
// vertical tick renders under EVERY bucket (so any individual bar can be
// located precisely even between labels); the date/time text itself
// only renders under every Nth tick, per computeLabelStep.
function AxisLabels({ buckets, bucketUnit, rangeStart, rangeEnd }: { buckets: ChartBucket[]; bucketUnit: BucketUnit; rangeStart: string; rangeEnd: string }): JSX.Element {
  const step = computeLabelStep(buckets.length, bucketUnit)
  const includeDate = bucketUnit === 'hour' && rangeSpansMultipleDays(rangeStart, rangeEnd)

  return (
    <div className="mt-1.5 flex gap-px" style={{ paddingLeft: Y_AXIS_GUTTER_PX }}>
      {buckets.map((b, i) => (
        <div key={b.bucket} className="flex flex-1 flex-col items-center overflow-visible">
          <div className="h-1 w-px bg-border" />
          {i % step === 0 && (
            <span className="mt-1 whitespace-nowrap text-[9px] leading-none text-muted-500">{formatAxisLabel(b.bucket, bucketUnit, includeDate)}</span>
          )}
        </div>
      ))}
    </div>
  )
}

const UPTIME_HEIGHT_PX = 36

// Presence/absence only, per bucket - green if at least one capture row
// landed in that window, red if none. Deliberately not a value chart:
// this is the fastest way to spot a real outage (station down, capture
// worker not running) at a glance across a whole range. Adjacent
// same-status buckets are merged into one logical segment for hover
// purposes (computeSegments) - hovering any bucket in a 40-bucket-long
// green run shows ONE tooltip for the whole run's start/end/duration,
// not 40 separate one-bucket tooltips.
interface UptimeSegment {
  startIndex: number
  endIndex: number
  hasCapture: boolean
}

function computeSegments(buckets: ChartBucket[]): UptimeSegment[] {
  const segments: UptimeSegment[] = []
  buckets.forEach((b, i) => {
    const last = segments[segments.length - 1]
    if (last && last.hasCapture === b.hasCapture) {
      last.endIndex = i
    } else {
      segments.push({ startIndex: i, endIndex: i, hasCapture: b.hasCapture })
    }
  })
  return segments
}

function segmentTooltipText(seg: UptimeSegment, buckets: ChartBucket[], bucketUnit: BucketUnit): string {
  const startIso = buckets[seg.startIndex].bucket
  const endIso = new Date(new Date(buckets[seg.endIndex].bucket).getTime() + BUCKET_MS[bucketUnit]).toISOString()
  const duration = formatDuration(new Date(endIso).getTime() - new Date(startIso).getTime())
  const range = `${formatTooltipDate(startIso)} → ${formatTooltipDate(endIso)} · ${duration}`
  return seg.hasCapture ? range : `No captures: ${range}`
}

function UptimeStrip({ buckets, bucketUnit }: { buckets: ChartBucket[]; bucketUnit: BucketUnit }): JSX.Element {
  const { containerRef, tooltip, show, hide } = useChartTooltip()
  const segments = computeSegments(buckets)
  const segmentByIndex: UptimeSegment[] = []
  segments.forEach((seg) => {
    for (let i = seg.startIndex; i <= seg.endIndex; i++) segmentByIndex[i] = seg
  })

  return (
    <div ref={containerRef} className="relative" style={{ paddingLeft: Y_AXIS_GUTTER_PX }}>
      <div className="flex w-full gap-px overflow-hidden rounded-lg border border-border" style={{ height: UPTIME_HEIGHT_PX }}>
        {buckets.map((b, i) => {
          const seg = segmentByIndex[i]
          return (
            <div
              key={b.bucket}
              onMouseEnter={(e) => show(e.currentTarget, segmentTooltipText(seg, buckets, bucketUnit))}
              onMouseLeave={hide}
              className={`flex-1 ${b.hasCapture ? 'bg-status-good' : 'bg-status-bad'}`}
            />
          )
        })}
      </div>
      <TooltipOverlay tooltip={tooltip} />
    </div>
  )
}

const CHART_HEIGHT_PX = 260

// Fixed axis domain with subtle gridlines every `step` units, extending
// gracefully beyond the fixed base range if real data ever exceeds it
// (rather than clipping bars against the chart's own edge) - confirmed
// against real production data before hardcoding these bases that
// neither case currently occurs (max observed so far: ~36°C, ~28kt),
// but a UK station can plausibly see sub-zero winter temperatures, so
// the low end extends too, not just the high end.
function computeAxisScale(values: number[], baseMin: number, baseMax: number, step: number): { min: number; max: number; ticks: number[] } {
  let min = baseMin
  let max = baseMax
  if (values.length > 0) {
    const dataMin = Math.min(...values)
    const dataMax = Math.max(...values)
    while (dataMin < min) min -= step
    while (dataMax > max) max += step
  }
  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100)
  return { min, max, ticks }
}

// Shared min/max-per-bucket range chart, reused for both temperature and
// wind - a thin vertical bar spanning [min, max] observed within that
// bucket, against a fixed gridlined scale (see computeAxisScale).
// markerKey is optional and renders as a single thin tick rather than a
// range (used for wind gust, which - confirmed against real production
// data before building this - is populated on only ~1-8% of rows, so a
// fully-fledged third range series would be mostly empty; an occasional
// marker is the honest representation of how sparse it is).
function RangeBarChart({
  buckets,
  bucketUnit,
  minKey,
  maxKey,
  markerKey,
  unitSuffix,
  baseMin,
  baseMax,
  axisStep,
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
  baseMin: number
  baseMax: number
  axisStep: number
  barColorClass: string
  markerColorClass?: string
  emptyMessage: string
}): JSX.Element {
  const { containerRef, tooltip, show, hide } = useChartTooltip()

  const values: number[] = []
  for (const b of buckets) {
    if (b[minKey] != null) values.push(b[minKey] as number)
    if (b[maxKey] != null) values.push(b[maxKey] as number)
    if (markerKey && b[markerKey] != null) values.push(b[markerKey] as number)
  }

  if (values.length === 0) {
    return <p className="text-sm text-muted-500">{emptyMessage}</p>
  }

  const { min: scaleMin, max: scaleMax, ticks } = computeAxisScale(values, baseMin, baseMax, axisStep)
  const span = scaleMax - scaleMin

  function toPct(value: number): number {
    return ((value - scaleMin) / span) * 100
  }

  return (
    <div ref={containerRef} className="relative" style={{ height: CHART_HEIGHT_PX }}>
      {ticks.map((t) => (
        <div key={t} className="absolute inset-x-0" style={{ bottom: `${toPct(t)}%` }}>
          <div className="absolute right-0 border-t border-white/[0.06]" style={{ left: Y_AXIS_GUTTER_PX }} />
          <span className="absolute left-0 -translate-y-1/2 text-[9px] leading-none text-muted-500">
            {t}
            {unitSuffix}
          </span>
        </div>
      ))}
      <div className="absolute inset-0 flex items-stretch gap-px" style={{ paddingLeft: Y_AXIS_GUTTER_PX, paddingRight: 4 }}>
        {buckets.map((b) => {
          const min = b[minKey] as number | null
          const max = b[maxKey] as number | null
          const marker = markerKey ? (b[markerKey] as number | null) : null
          const hasRange = min != null && max != null
          const tooltipText = hasRange
            ? `${formatTooltipDate(b.bucket)} — ${min}–${max}${unitSuffix}${marker != null ? `, gust ${marker}${unitSuffix}` : ''}`
            : `${formatTooltipDate(b.bucket)} — no data`
          return (
            <div
              key={b.bucket}
              className="relative h-full flex-1"
              // Anchor the tooltip to the actual visible bar (data-bar),
              // not this wrapper - the wrapper spans the FULL chart
              // height deliberately (so the whole column is hoverable,
              // not just a thin bar), so anchoring to it directly would
              // always pin the tooltip to the top of the chart
              // regardless of the bar's real value/position.
              onMouseEnter={(e) => show(e.currentTarget.querySelector<HTMLElement>('[data-bar]') ?? e.currentTarget, tooltipText)}
              onMouseLeave={hide}
            >
              {hasRange && (
                <div
                  data-bar
                  className={`absolute w-full rounded-sm ${barColorClass}`}
                  style={{
                    bottom: `${toPct(min as number)}%`,
                    height: `${Math.max(1, toPct(max as number) - toPct(min as number))}%`,
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
      <TooltipOverlay tooltip={tooltip} />
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
        <div className="space-y-6">
          <p className="text-xs text-muted-500">
            {chartData.buckets.length} buckets ({chartData.bucketUnit}) from {formatDate(chartData.start)} to {formatDate(chartData.end)} · source:{' '}
            {chartData.source === 'weather_observations' ? 'full-resolution captures' : '15-minute snapshots'}
          </p>

          <section className="rounded-2xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-100">Uptime</h2>
            <UptimeStrip buckets={chartData.buckets} bucketUnit={chartData.bucketUnit} />
            <AxisLabels buckets={chartData.buckets} bucketUnit={chartData.bucketUnit} rangeStart={chartData.start} rangeEnd={chartData.end} />
          </section>

          <section className="rounded-2xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-100">Temperature (°C)</h2>
            <RangeBarChart
              buckets={chartData.buckets}
              bucketUnit={chartData.bucketUnit}
              minKey="tempMin"
              maxKey="tempMax"
              unitSuffix="°C"
              baseMin={0}
              baseMax={40}
              axisStep={5}
              barColorClass="bg-accent-sky-500"
              emptyMessage="No temperature data in this range."
            />
            <AxisLabels buckets={chartData.buckets} bucketUnit={chartData.bucketUnit} rangeStart={chartData.start} rangeEnd={chartData.end} />
          </section>

          <section className="rounded-2xl border border-border bg-panel p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-100">
              Wind (kt)
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/5 px-2 py-0.5 text-[10px] font-normal normal-case tracking-normal text-muted-400">
                <span className="inline-block h-2 w-3 rounded-sm bg-amber-400" aria-hidden="true" />
                amber tick = gust, where recorded
              </span>
            </h2>
            <RangeBarChart
              buckets={chartData.buckets}
              bucketUnit={chartData.bucketUnit}
              minKey="windMin"
              maxKey="windMax"
              markerKey="gustMax"
              unitSuffix="kt"
              baseMin={0}
              baseMax={50}
              axisStep={5}
              barColorClass="bg-violet-400"
              markerColorClass="bg-amber-400"
              emptyMessage="No wind data in this range."
            />
            <AxisLabels buckets={chartData.buckets} bucketUnit={chartData.bucketUnit} rangeStart={chartData.start} rangeEnd={chartData.end} />
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
