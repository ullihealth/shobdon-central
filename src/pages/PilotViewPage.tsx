import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
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
import AutoNotamsScrollPanel from '../components/pilot/AutoNotamsScrollPanel'
import PilotNoticesPanel from '../components/pilot/PilotNoticesPanel'
import PilotCollapsibleSection from '../components/pilot/PilotCollapsibleSection'
import PilotFooterTicker from '../components/pilot/PilotFooterTicker'
import PilotRunwayWindPanel from '../components/pilot/PilotRunwayWindPanel'
import PilotWindCard from '../components/pilot/PilotWindCard'
import CompassPanel from '../components/CompassPanel'
import GasPricesPanel from '../components/GasPricesPanel'

const REFRESH_INTERVAL_MS = 60_000

interface PilotViewContentProps {
  airfieldName: string | null
  logoUrl: string | null
  afisoOpen: boolean
  afisoFrequency: string
  refreshTick: number
  onManualRefresh: () => void
}

// Everything that used to render directly inside PilotViewPage's own
// <WeatherProvider> below, pulled out into its own component so it can
// call useWeather() - PilotViewPage itself renders WeatherProvider, so
// it sits ABOVE that context in the tree and can never read from it
// directly; a component that's genuinely a child of the provider is
// required for pull-to-refresh to reach refetchNow. Branding state/
// refreshTick/loadBranding stay owned by the parent (several of them
// gate whether WeatherProvider even renders at all, via the early
// returns below) and are threaded down as plain props instead.
function PilotViewContent({ airfieldName, logoUrl, afisoOpen, afisoFrequency, refreshTick, onManualRefresh }: PilotViewContentProps): JSX.Element {
  const { refetchNow } = useWeather()

  // Pull-to-refresh's own guaranteed backstop: always calls both the
  // branding/refreshTick refresh (onManualRefresh, from the parent) AND
  // weather's own refetchNow, regardless of whether the online/
  // visibilitychange listeners in WeatherContext.tsx already caught a
  // reconnect - a manual gesture should never depend on having also
  // guessed right about why the data looked stale.
  function handlePullRefresh() {
    onManualRefresh()
    refetchNow()
  }

  const { pulling, pullDistance } = usePullToRefresh(handlePullRefresh)

  return (
    <div className="min-h-screen overscroll-y-contain bg-gradient-to-b from-page-from via-page-via to-page-to pb-20 text-slate-100">
      {pulling && (
        // Sized to actually be legible at arm's length / outdoors, not
        // fine print - was text-xs/text-muted-400 (12px, dim grey),
        // easy to miss entirely against the page's own gradient
        // background - worse than the nominal Tailwind px value suggests,
        // since :root's own font-size is clamp(12px, 1.5vmin, 20px) (a
        // TV-dashboard vmin scale this page inherits) and floors at 12px
        // on a real phone viewport, confirmed via computed style (12px
        // root -> text-xs really rendered ~9px). Sized up to text-2xl/
        // text-4xl (not the more modest text-lg a 16px-root assumption
        // would suggest) specifically to compensate and land at a size
        // that's genuinely legible at arm's length against that 12px
        // floor, confirmed via computed style after this change too.
        // font-bold + text-white for contrast, plus a simple arrow glyph
        // (no icon library) that flips upright past the release
        // threshold - same rotating-indicator idiom
        // PilotCollapsibleSection's own chevron already uses, not a new
        // one invented for this.
        <div
          className="flex items-center justify-center gap-2 overflow-hidden text-2xl font-bold text-white transition-[height]"
          style={{ height: Math.min(pullDistance, 60) }}
        >
          <span
            className={`inline-block text-4xl transition-transform ${pullDistance > 80 ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            ↓
          </span>
          {pullDistance > 80 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}

      <PilotHeader airfieldName={airfieldName} logoUrl={logoUrl} afisoOpen={afisoOpen} afisoFrequency={afisoFrequency} />

      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
        {/* Second reorder round: standalone WIND readout now leads the
            page, in its own full-width card (PilotWindCard.tsx) -
            pulled out of PilotRunwayWindPanel, which used to render it
            inline above its own widget group. Order below is now:
            Wind card -> Weather Summary -> runway/windsock group ->
            compass -> NOTAMs -> Forecast & Visibility -> Notices ->
            Fuel Prices. */}
        <PilotWindCard />
        <WeatherStatGrid />
        <PilotRunwayWindPanel refreshSignal={refreshTick} />
        {/* Compass instrument - hideReadout drops its own text readout
            list (Wind/Headwind/Crosswind/Trend), since the widget above
            already shows Wind/Headwind/Crosswind; the rose/arrow/centre-
            label instrument itself renders exactly as it always has,
            same as every TV-dashboard caller. Desktop dashboard remains
            completely untouched either way - CompassPanel itself only
            gained an opt-in prop, defaulted off everywhere else. */}
        <CompassPanel spacious hideReadout />
        {/* NOTAMs/Forecast/Notices/Fuel Prices - collapsed by default,
            title always visible, tap to expand. Each panel keeps
            fetching/refreshing on its own existing schedule regardless
            of collapsed state - see PilotCollapsibleSection's own
            comment for why. */}
        <PilotCollapsibleSection title="NOTAMs">
          <AutoNotamsScrollPanel refreshSignal={refreshTick} />
        </PilotCollapsibleSection>
        <PilotCollapsibleSection title="Forecast & Visibility">
          <ForecastCloudbaseCluster />
        </PilotCollapsibleSection>
        <PilotCollapsibleSection
          title="Club & Safety Notices"
          sectionClassName="rounded-2xl border-2 border-accent-sky-500/40 bg-accent-sky-500/5 p-4"
          titleClassName="text-xl font-semibold uppercase tracking-[0.25em] text-accent-sky-400"
          chevronClassName="text-accent-sky-400"
        >
          <PilotNoticesPanel refreshSignal={refreshTick} />
        </PilotCollapsibleSection>
        <PilotCollapsibleSection title="Fuel Prices">
          <GasPricesPanel hideTitle largeText />
        </PilotCollapsibleSection>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-10">
        <PilotFooterTicker />
      </div>
    </div>
  )
}

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
  // (PilotRunwayWindPanel, AutoNotamsScrollPanel). Weather/forecast poll
  // independently via WeatherContext/useVisibilityForecast's own
  // intervals (already ~60s and 15min respectively - see the approved
  // plan's own note on why the forecast interval is deliberately not
  // forced to 60s). Fuel/notices are excluded entirely - load-on-mount
  // only, per spec.
  useEffect(() => {
    const interval = window.setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  // Passed down to PilotViewContent as onManualRefresh - the non-weather
  // half of pull-to-refresh (branding/NOTAMs/notices/runway panel).
  // Weather's own half (refetchNow) is called separately by
  // PilotViewContent itself, since only a component INSIDE
  // WeatherProvider can reach it - see that component's own comment.
  function handleManualRefresh() {
    setRefreshTick((tick) => tick + 1)
    loadBranding()
  }

  if (unavailable) return <TenantUnavailable />
  if (!loaded) return <div className="min-h-screen bg-page-from" />
  if (!mobileEnabled) return <PilotLockedScreen airfieldName={airfieldName} logoUrl={logoUrl} themeOverride={themeOverride} />

  return (
    <WeatherProvider>
      <PilotViewContent
        airfieldName={airfieldName}
        logoUrl={logoUrl}
        afisoOpen={afisoOpen}
        afisoFrequency={afisoFrequency}
        refreshTick={refreshTick}
        onManualRefresh={handleManualRefresh}
      />
    </WeatherProvider>
  )
}
