import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { useDisplayHeartbeat } from '../hooks/useDisplayHeartbeat'
import { usePullToRefresh, REFRESH_THRESHOLD_PX } from '../hooks/usePullToRefresh'
import { usePilotHomeScreenMeta } from '../hooks/usePilotHomeScreenMeta'
import { usePilotServiceWorker } from '../hooks/usePilotServiceWorker'
import { usePilotDataFreshnessGuard } from '../hooks/usePilotDataFreshnessGuard'
import TenantUnavailable from '../components/TenantUnavailable'
import PilotLockedScreen from '../components/pilot/PilotLockedScreen'
import PilotUpdateBanner from '../components/pilot/PilotUpdateBanner'
import PilotHeader from '../components/pilot/PilotHeader'
import WeatherStatGrid from '../components/pilot/WeatherStatGrid'
import ForecastCloudbaseCluster from '../components/pilot/ForecastCloudbaseCluster'
import AutoNotamsScrollPanel from '../components/pilot/AutoNotamsScrollPanel'
import PilotNoticesPanel from '../components/pilot/PilotNoticesPanel'
import PilotCollapsibleSection from '../components/pilot/PilotCollapsibleSection'
import PilotFooterTicker from '../components/pilot/PilotFooterTicker'
import PilotVersionStamp from '../components/pilot/PilotVersionStamp'
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
  const { refetchNow, dataStale } = useWeather()
  usePilotDataFreshnessGuard()

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
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to pb-20 text-slate-100">
      {/* Sized to actually be legible at arm's length / outdoors, not
          fine print - was text-xs/text-muted-400 (12px, dim grey),
          easy to miss entirely against the page's own gradient
          background - worse than the nominal Tailwind px value suggests,
          since :root's own font-size is clamp(12px, 1.5vmin, 20px) (a
          TV-dashboard vmin scale this page inherits) and floors at 12px
          on a real phone viewport, confirmed via computed style (12px
          root -> text-xs really rendered ~9px). Sized up to text-2xl/
          text-4xl (not the more modest text-lg a 16px-root assumption
          would suggest) specifically to compensate and land at a size
          that's genuinely legible at arm's length against that 12px
          floor, confirmed via computed style after this change too.
          font-bold + text-white for contrast, plus a simple arrow glyph
          (no icon library) that flips upright past the release
          threshold - same rotating-indicator idiom
          PilotCollapsibleSection's own chevron already uses, not a new
          one invented for this.

          Always mounted now (no more {pulling && ...} conditional) -
          height 0 and invisible when idle, same as before, but staying
          in the DOM across release is what lets the snap-back transition
          below actually play; the old mount/unmount pattern removed the
          element in the same render that reset its height, so the
          transition never got a chance to run at all. Transition classes
          are conditional on `pulling` for the opposite reason: while
          actively dragging, no transition - height/rotation update
          instantly on every touchmove, 1:1 with the finger, which is
          what "the indicator tracks your finger" actually requires (a
          CSS transition here was continuously re-easing toward a
          constantly-moving target on every touchmove, which is the
          laggy "spring" feel this exists to remove). Only once `pulling`
          goes false (finger lifted) does the transition apply, so the
          indicator eases back to 0 rather than jump-cutting.

          Height cap raised from a hardcoded 60 to REFRESH_THRESHOLD_PX
          (150) - ties the indicator's visual completion directly to the
          real arm threshold instead of an unrelated number, so it grows
          continuously across the ENTIRE required gesture and finishes
          growing exactly when it arms, rather than maxing out at 120px
          of raw finger travel (40% of the way through the new, longer
          pull) and sitting frozen for the rest. */}
      <div
        className={`flex items-center justify-center gap-2 overflow-hidden text-2xl font-bold text-white ${pulling ? '' : 'transition-[height] duration-200'}`}
        style={{ height: pulling ? Math.min(pullDistance, REFRESH_THRESHOLD_PX) : 0 }}
      >
        <span
          className={`inline-block text-4xl ${pulling ? '' : 'transition-transform duration-200'} ${pullDistance > REFRESH_THRESHOLD_PX ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          ↓
        </span>
        {pullDistance > REFRESH_THRESHOLD_PX ? 'Release to refresh' : 'Pull to refresh'}
      </div>

      <PilotHeader airfieldName={airfieldName} logoUrl={logoUrl} afisoOpen={afisoOpen} afisoFrequency={afisoFrequency} />

      {/* Data-freshness safety net (dataStale, WeatherContext.tsx) -
          deliberately independent of the weather status badge's own
          live/fallback/no-reading state, since this exists specifically
          for the case where that badge is confidently showing a status
          that's no longer true because the poll loop behind it silently
          stopped ticking (backgrounded-tab timer throttling, a stuck
          effect) - usePilotDataFreshnessGuard's pageshow/touch listeners
          are the automatic recovery attempt; this banner is what's
          visible for however long it takes one of those (or a manual
          pull-to-refresh) to actually succeed. Normal in-flow element,
          not position:fixed/absolute - same reasoning as the pull-to-
          refresh banner above: a fixed overlay stops reserving its own
          space and can collide with whatever sits below it. Styled with
          the same border-2 + tinted-background + bold label shape as
          the Club & Safety Notices section below (status-warn amber
          instead of that section's accent-sky), not a new visual
          pattern invented for this. Copy is deliberately just the
          instruction itself ("Pull to Refresh"), not a question or an
          alarm - matches the plain, direct label style already used
          throughout this page. */}
      {dataStale && (
        // border-status-warn/bg-slate-900/60 rather than the
        // border-status-warn/40 + bg-status-warn/5 tinted-opacity combo
        // Club & Safety Notices below uses - confirmed via direct
        // rendering that this Tailwind config's custom colours (all
        // plain `var(--x)` references, not the rgb(var(...) / <alpha>)
        // form opacity modifiers need) don't actually apply an opacity
        // modifier at all; border-status-warn/40 silently fell back to
        // Tailwind's own default border colour, not amber. Solid
        // border-status-warn (no modifier) is confirmed to render
        // correctly; bg-slate-900/60 is a bundled Tailwind colour,
        // whose opacity modifier works normally, used here only for a
        // bit of visual weight behind the text, not for the amber tint.
        <div className="mx-auto mt-4 flex max-w-lg items-center justify-center gap-2 rounded-2xl border-2 border-status-warn bg-slate-900/60 px-4 py-3 text-status-warn">
          <span className="text-xl" aria-hidden="true">↓</span>
          <span className="text-sm font-bold uppercase tracking-widest">Pull to Refresh</span>
        </div>
      )}

      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-4">
        {/* Third reorder round: compass moved up to sit directly under
            the Wind card, ahead of the Weather Summary grid. Order below
            is now: Wind card -> compass -> Weather Summary -> runway/
            windsock group -> NOTAMs -> Forecast & Visibility -> Notices
            -> Fuel Prices. Pure JSX reorder, nothing else - the North/
            Runway toggle buttons' own "higher on each shoulder"
            placement (CompassPanel.tsx's own mb-[-33px]/sm:mb-[-29px])
            cancels THAT component's own internal gap-8/sm:gap-7 (the gap
            between the button row and the compass instrument, both
            direct children of CompassPanel's own self-contained root
            div) - it has no dependency at all on this page's own gap-4
            layout or on whichever component happens to sit next to it
            here, so moving CompassPanel to a new page position carries
            that internal relationship with it unchanged automatically.
            Confirmed via direct measurement, not just this reasoning:
            gap between button-bottom and the compass SVG's own top edge
            was -9px before this move, still -9px after. */}
        <PilotWindCard />
        {/* Compass instrument - hideReadout drops its own text readout
            list (Wind/Headwind/Crosswind/Trend), since the runway/wind
            panel below already shows Wind/Headwind/Crosswind; the rose/
            arrow/centre-label instrument itself renders exactly as it
            always has, same as every TV-dashboard caller. Desktop
            dashboard remains completely untouched either way -
            CompassPanel itself only gained an opt-in prop, defaulted
            off everywhere else. */}
        <CompassPanel spacious hideReadout />
        <WeatherStatGrid />
        <PilotRunwayWindPanel refreshSignal={refreshTick} />
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
        {/* Was a distinct accent-sky (blue) border/title/chevron treatment,
            per request now matched to the same grey styling as the other
            three cards (NOTAMs/Forecast & Visibility/Fuel Prices) instead
            of standing out - no className overrides passed here at all
            now, so it falls through to PilotCollapsibleSection's own
            defaults, identically to those three. */}
        <PilotCollapsibleSection title="Club & Safety Notices">
          <PilotNoticesPanel refreshSignal={refreshTick} />
        </PilotCollapsibleSection>
        <PilotCollapsibleSection title="Fuel Prices">
          <GasPricesPanel hideTitle largeText />
        </PilotCollapsibleSection>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-10">
        {/* Small, unobtrusive version stamp (PilotVersionStamp.tsx) -
            baked in at build time from platform_updates (see that
            component's own comment), not a live fetch any more - no
            refreshSignal prop, pull-to-refresh has nothing to do with
            it. Sits above PilotFooterTicker (which can render null with
            no ticker content configured - see that component's own
            hasRealContent gate), so the version stamp stays visible
            either way rather than depending on the ticker actually
            rendering. */}
        <PilotVersionStamp />
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
  const { updateAvailable, applyUpdate } = usePilotServiceWorker()

  // Scopes the touch-action/overscroll-behavior fix (index.css's own
  // .pilot-view-scroll-root rule) to this route only - html/body are
  // shared across every route in this single-page app, so toggling the
  // class here on mount/unmount rather than declaring it unscoped is
  // what keeps the desktop TV dashboard and every other page's own
  // scroll/overscroll behaviour completely untouched. Applied
  // regardless of which /pilot sub-state (locked screen, loading, full
  // view) is currently rendering below - harmless either way, and
  // avoids the fix flickering on/off as those states change.
  useEffect(() => {
    document.documentElement.classList.add('pilot-view-scroll-root')
    document.body.classList.add('pilot-view-scroll-root')
    return () => {
      document.documentElement.classList.remove('pilot-view-scroll-root')
      document.body.classList.remove('pilot-view-scroll-root')
    }
  }, [])

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
  if (!mobileEnabled) {
    return (
      <>
        {updateAvailable && <PilotUpdateBanner onTap={applyUpdate} />}
        <PilotLockedScreen airfieldName={airfieldName} logoUrl={logoUrl} themeOverride={themeOverride} />
      </>
    )
  }

  return (
    <WeatherProvider>
      {updateAvailable && <PilotUpdateBanner onTap={applyUpdate} />}
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
