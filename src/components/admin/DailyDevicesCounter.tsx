import { useEffect, useState } from 'react'

const DAILY_DEVICES_URL = '/api/platform/visits/daily-devices'
// Matches the Visit Log's own retention (heartbeat.ts RETENTION_DAYS) -
// nothing older than this exists to count.
const RETENTION_DAYS = 30

// Today / any day below are UK local calendar days (Europe/London), as
// plain YYYY-MM-DD strings - the server converts the chosen day to its UTC
// window, so the browser's own timezone never matters here.
function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
}

function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .replace(',', '')
}

interface Counts {
  main: number
  pilot: number
  total: number
}

interface Props {
  tenantId: number | undefined
  hideGroups: string[]
  // Bumped by the page's own Refresh button so this refetches with it.
  refreshTick: number
}

// Unique devices (distinct IP) that used the app on one London day, split
// Main / Pilot / Total. TOTAL is distinct across both views, not Main + Pilot.
export function DailyDevicesCounter({ tenantId, hideGroups, refreshTick }: Props) {
  const today = londonToday()
  const earliest = shiftDay(today, -RETENTION_DAYS)
  const [date, setDate] = useState(today)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const hideKey = hideGroups.join(',')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ date })
    if (tenantId !== undefined) params.set('tenantId', String(tenantId))
    if (hideKey) params.set('hideGroups', hideKey)
    fetch(`${DAILY_DEVICES_URL}?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data.total === 'number') {
          setCounts({ main: data.main, pilot: data.pilot, total: data.total })
          setError(false)
        } else {
          setError(true)
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date, tenantId, hideKey, refreshTick])

  function pick(next: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return
    setDate(next > today ? today : next < earliest ? earliest : next)
  }

  const cell = (label: string, value: number | undefined) => (
    <div className="flex-1 text-center">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-500">{label}</div>
      <div className={`text-4xl font-black tabular-nums text-primary ${loading ? 'opacity-50' : ''}`}>
        {error || value === undefined ? '—' : value}
      </div>
    </div>
  )

  const navButton =
    'rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm font-bold text-accent-sky-400 hover:border-sky-500 disabled:opacity-30 disabled:hover:border-slate-700'

  return (
    <div className="w-full rounded-xl border border-border bg-panel/60 p-4 lg:w-[26rem]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous day" className={navButton} disabled={date <= earliest} onClick={() => pick(shiftDay(date, -1))}>
          ‹
        </button>
        <div className="flex min-w-0 flex-col items-center gap-1">
          <span className="text-sm font-semibold text-primary">{formatDay(date)}</span>
          <input
            type="date"
            value={date}
            min={earliest}
            max={today}
            onChange={(event) => pick(event.target.value)}
            aria-label="Day to count"
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button type="button" aria-label="Next day" className={navButton} disabled={date >= today} onClick={() => pick(shiftDay(date, 1))}>
          ›
        </button>
      </div>
      <div className="flex items-start gap-2">
        {cell('Main', counts?.main)}
        {cell('Pilot', counts?.pilot)}
        {cell('Total', counts?.total)}
      </div>
      <p className="mt-3 text-center text-xs text-muted-500">
        Devices counted by IP address
        {hideKey && ' (excluding hidden labels)'}
      </p>
    </div>
  )
}
