import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { WeatherProvider } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { useDisplayHeartbeat } from '../hooks/useDisplayHeartbeat'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { usePilotHomeScreenMeta } from '../hooks/usePilotHomeScreenMeta'
import { usePilotServiceWorker } from '../hooks/usePilotServiceWorker'
import TenantUnavailable from '../components/TenantUnavailable'
import PilotLockedScreen from '../components/pilot/PilotLockedScreen'
import PilotHeader from '../components/pilot/PilotHeader'
import WeatherStatGrid from '../components/pilot/WeatherStatGrid'
import ForecastCloudbaseCluster from '../components/pilot/ForecastCloudbaseCluster'
import RunwayInUseCard from '../components/pilot/RunwayInUseCard'
import AutoNotamsScrollPanel from '../components/pilot/AutoNotamsScrollPanel'
import PilotNoticesPanel from '../components/pilot/PilotNoticesPanel'
import PilotFooterTicker from '../components/pilot/PilotFooterTicker'
import CompassPanel from '../components/CompassPanel'
import GasPricesPanel from '../components/GasPricesPanel'

const REFRESH_INTERVAL_MS = 60_000

// Mobile-first, single-column, read-only per-tenant pilot information
// screen. Self-fetches PUBLIC_CONFIG_URL exactly like DashboardPage.tsx,
// resolving whichever tenant the request's Host header belongs to (no
// path-based tenant resolution needed - see App.tsx's own route
// comment). No carousels/rotation anywhere - every section renders
// permanently, natural document scroll.
export default function PilotViewPage(): JSX.Element {
  useDisplayHeartbeat('pilot')
  usePilotServiceWorker()

  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [afisoOpen, setAfisoOpen] = useState(false)
  const [afisoFrequency, setAfisoFrequency] = useState('')
  // Mobile access gating round (migration 0071) - defaults true (not the
  // column's own false default) so a transient/malformed config response
  // during this testing phase never accidentally locks someone out;
  // real, current tenant data (every existing tenant backfilled to true)
  // overwrites this the moment the fetch resolves either way. themeOverride
  // is the same club_theme CSS-variable mechanism DashboardPage.tsx
  // already applies to the TV templates - only actually used by
  // PilotLockedScreen below (the full view doesn't need it - see that
  // component's own comment).
  const [mobileEnabled, setMobileEnabled] = useState(true)
  const [themeOverride, setThemeOverride] = useState<CSSProperties>({})
  const [unavailable, setUnavailable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  function loadBranding() {
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => {
        if (!response.ok) {
          setUnavailable(true)
          return null
        }
        return response.json()
      })
      .then((data) => {
        if (!data) return
        if (data.airfieldName) {
          setAirfieldName(data.airfieldName)
          document.title = `${data.airfieldName} — Pilot View`
        }
        if (data.logoUrl) setLogoUrl(data.logoUrl)
        if (data.afiso) {
          setAfisoOpen(!!data.afiso.open)
          setAfisoFrequency(data.afiso.frequency ?? '')
        }
        if (typeof data.mobileEnabled === 'boolean') setMobileEnabled(data.mobileEnabled)
        if (data.theme) setThemeOverride(data.theme as CSSProperties)
        if (data.mainDisplayActive === false) setUnavailable(true)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }

  useEffect(() => {
    loadBranding()
  }, [])

  usePilotHomeScreenMeta(airfieldName, logoUrl)

  // Single 60s tick, bumped by both the interval and pull-to-refresh -
  // passed to whichever child panels don't already self-poll
  // (RunwayInUseCard, AutoNotamsScrollPanel). Weather/forecast poll
  // independently via WeatherContext/useVisibilityForecast's own
  // intervals (already ~60s and 15min respectively - see the approved
  // plan's own note on why the forecast interval is deliberately not
  // forced to 60s). Fuel/notices are excluded entirely - load-on-mount
  // only, per spec.
  useEffect(() => {
    const interval = window.setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  function handlePullRefresh() {
    setRefreshTick((tick) => tick + 1)
    loadBranding()
  }

  const { pulling, pullDistance } = usePullToRefresh(handlePullRefresh)

  if (unavailable) return <TenantUnavailable />
  if (!loaded) return <div className="min-h-screen bg-page-from" />
  if (!mobileEnabled) return <PilotLockedScreen airfieldName={airfieldName} logoUrl={logoUrl} themeOverride={themeOverride} />

  return (
    <WeatherProvider>
      <div className="min-h-screen overscroll-y-contain bg-gradient-to-b from-page-from via-page-via to-page-to pb-20 text-slate-100">
        {pulling && (
          <div
            className="flex items-center justify-center overflow-hidden text-xs text-muted-400 transition-[height]"
            style={{ height: Math.min(pullDistance, 60) }}
          >
            {pullDistance > 80 ? 'Release to refresh…' : 'Pull to refresh…'}
          </div>
        )}

        <PilotHeader airfieldName={airfieldName} logoUrl={logoUrl} afisoOpen={afisoOpen} afisoFrequency={afisoFrequency} />

        <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
          <WeatherStatGrid />
          <ForecastCloudbaseCluster />
          <RunwayInUseCard refreshSignal={refreshTick} />
          {/* No fixed-height wrapper here (unlike every other section, which
              is already naturally-flowing) - CompassPanel itself now sizes
              its circle off width below `sm:` (see that component's own
              comment), so it needs no ancestor-supplied height on this
              route; a percentage h-full with no definite ancestor height
              simply resolves as auto, matching natural page flow. */}
          <CompassPanel />
          <AutoNotamsScrollPanel refreshSignal={refreshTick} />
          <PilotNoticesPanel refreshSignal={refreshTick} />
          <GasPricesPanel />
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-10">
          <PilotFooterTicker />
        </div>
      </div>
    </WeatherProvider>
  )
}
