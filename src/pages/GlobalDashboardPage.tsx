import { useEffect, useState } from 'react'
import { PUBLIC_TENANTS_URL } from '../config/publicApi'

// Public, unauthenticated cross-tenant directory - GET PUBLIC_TENANTS_URL
// (functions/api/public/tenants.ts), gated server-side by each tenant's
// own weather_public/ops_public flags. One-shot fetch on mount, no
// polling - unlike the kiosk dashboard (DashboardPage.tsx), this is a
// page a human visits occasionally, not a live TV display.
//
// Deliberately NOT using the theme-token classes (bg-page-from etc.)
// DashboardPage.tsx applies - those are CSS custom properties whose
// committed :root defaults currently equal Shobdon's own theme colours,
// so reusing them here without fetching a theme would make this page
// silently look like "Shobdon's page" even though it represents every
// tenant equally. Fixed neutral Tailwind slate palette instead.

interface WeatherListing {
  observedAt: string | null
  windSpeedKt: number | null
  windDirDeg: number | null
  windGustKt: number | null
  qnhHpa: number | null
  tempC: number | null
  dewpointC: number | null
  visibilityM: number | null
  lastUpdatedAt: string
  isStale: boolean
}

interface OpsEventListing {
  id: number
  category: string
  severity: string
  message: string
  startsAt: string
  expiresAt: string | null
}

interface TenantListing {
  slug: string
  name: string
  subdomain: string
  icaoCode: string | null
  lat: number | null
  lon: number | null
  weather?: WeatherListing
  ops?: OpsEventListing[]
}

type LoadState = { status: 'loading' } | { status: 'loaded'; tenants: TenantListing[] } | { status: 'error' }

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  caution: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  closed: 'bg-red-500/20 text-red-300 border-red-500/40',
}

function formatWind(w: WeatherListing): string {
  if (w.windSpeedKt == null) return '—'
  const dir = w.windDirDeg != null ? `${Math.round(w.windDirDeg)}°` : '—'
  const gust = w.windGustKt != null ? ` (gust ${Math.round(w.windGustKt)}kt)` : ''
  return `${dir} ${Math.round(w.windSpeedKt)}kt${gust}`
}

function WeatherBlock({ weather }: { weather: WeatherListing }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Weather</span>
        {weather.isStale && (
          <span className="rounded border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            Stale
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-200">
        <div>
          <span className="text-slate-500">Wind</span> {formatWind(weather)}
        </div>
        <div>
          <span className="text-slate-500">QNH</span> {weather.qnhHpa != null ? `${Math.round(weather.qnhHpa)} hPa` : '—'}
        </div>
        <div>
          <span className="text-slate-500">Temp</span> {weather.tempC != null ? `${Math.round(weather.tempC)}°C` : '—'}
        </div>
        <div>
          <span className="text-slate-500">Visibility</span>{' '}
          {weather.visibilityM != null ? `${(weather.visibilityM / 1000).toFixed(1)}km` : '—'}
        </div>
      </div>
    </div>
  )
}

function OpsBlock({ ops }: { ops: OpsEventListing[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Operational notices</span>
      {ops.length === 0 ? (
        <div className="mt-2 text-sm text-slate-500">No active notices.</div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {ops.map((event) => (
            <li key={event.id} className="flex items-start gap-2 text-sm text-slate-200">
              <span
                className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium capitalize ${
                  SEVERITY_STYLES[event.severity] ?? SEVERITY_STYLES.info
                }`}
              >
                {event.category}
              </span>
              <span>{event.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TenantCard({ tenant }: { tenant: TenantListing }): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">{tenant.name}</h2>
        {tenant.icaoCode && <span className="text-sm font-mono text-slate-500">{tenant.icaoCode}</span>}
      </div>
      <div className="space-y-3">
        {tenant.weather && <WeatherBlock weather={tenant.weather} />}
        {tenant.ops && <OpsBlock ops={tenant.ops} />}
      </div>
      <a
        href={`https://${tenant.subdomain}/`}
        className="mt-4 inline-block text-sm font-medium text-sky-400 hover:text-sky-300 hover:underline"
      >
        View live dashboard →
      </a>
    </div>
  )
}

export default function GlobalDashboardPage(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetch(PUBLIC_TENANTS_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => {
        if (!cancelled) setState({ status: 'loaded', tenants: data as TenantListing[] })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen w-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">Airfield Central — Public Conditions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live weather and operational status from participating airfields.
          </p>
        </header>

        {state.status === 'loading' && <div className="text-sm text-slate-400">Loading…</div>}

        {state.status === 'error' && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            Unable to load airfield data right now. Please try again shortly.
          </div>
        )}

        {state.status === 'loaded' && state.tenants.length === 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-8 text-center">
            <p className="text-base font-medium text-slate-200">No airfields are currently sharing conditions.</p>
            <p className="mt-1 text-sm text-slate-500">
              Check back later, or contact your local airfield about publishing theirs.
            </p>
          </div>
        )}

        {state.status === 'loaded' && state.tenants.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {state.tenants.map((tenant) => (
              <TenantCard key={tenant.slug} tenant={tenant} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
