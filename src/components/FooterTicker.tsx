import { useEffect, useState } from 'react'
import CafeTicker, { type TickerGasPrices, type TickerSlot, type TickerStyle } from './CafeTicker'
import { TEMPLATE_EDGE_PADDING } from '../config/templateLayout'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { useWeather } from '../context/WeatherContext'
import { useVisibilityForecast } from '../services/visibilityForecastService'

// Now free/universal for every tenant (not just café) - a deliberate
// reduction in what the café-tv paid bundle uniquely offers, confirmed,
// not an oversight. Reuses CafeTemplate.tsx's own existing data-fetch
// path exactly (same PUBLIC_CONFIG_URL fields: cafeSettings, opsPanel.
// safetyNotices, gasPrices - already served unconditionally for every
// tenant regardless of café entitlement, confirmed in publicConfig.ts),
// factored out into one shared, self-contained, no-props component so
// Clubhouse1Template.tsx/Clubhouse2Template.tsx/ClassicTemplate.tsx
// don't each need their own copy of this fetch. CafeTemplate.tsx itself
// is untouched on the fetch side - it already has this working, plus
// its own extra safetyNoticesData/gasPricesData override props this
// component doesn't need - but DOES need the exact same overlay
// positioning below, hand-mirrored there rather than imported (it
// doesn't use this component at all, matching this codebase's existing
// "hand-mirrored café JSX" precedent - see CafeTemplate.tsx's own
// comment).
//
// Overlay positioning (was a reserved grid row until this round): an
// absolutely-positioned element establishes its own containing block
// against the nearest `position: relative` ancestor's PADDING edge, not
// its true outer edge - so `left/right/bottom: 0` here would still sit
// INSET by the template's own clamp() padding, not actually at the
// screen edge. Each caller (Clubhouse1Template.tsx etc.) puts
// `position: relative` on its own outermost (padded) div specifically
// so this negative-offset math resolves against THAT box, whatever size
// it happens to be (the real screen, or - via isPreview - a small
// scaled preview box elsewhere), never the browser's true viewport.
// That's also why this is `position: absolute`, not `fixed`: fixed
// anchors to the actual browser viewport regardless of DOM nesting,
// which would break every scaled admin preview that reuses these same
// template components (DesignPage.tsx renders them at ~30% scale
// inside a small box - `fixed` positioning would escape that box
// entirely and pin to the real page's bottom edge instead).
//
// Height is NOT overridden or capped here - style.heightPx (CafeTicker's
// own `height` style below) is the tenant's own Ticker Style setting,
// unchanged by this round. "Slim by default" just falls out of
// heightPx's existing 24-200px range (default 64px) - a tenant who
// deliberately sets it larger gets exactly that, even if it then
// overlaps more of whatever panel content sits behind it (accepted
// trade-off of overlaying instead of reserving space, not something
// this component second-guesses).
interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

const DEFAULT_TICKER_STYLE: TickerStyle = {
  backgroundColor: '#0f172a',
  backgroundOpacity: 100,
  heightPx: 64,
  fontFamily: 'Inter',
  fontSizePx: 16,
  fontColor: '#ffffff',
  scrollSpeedPxPerSec: 80,
  gapPx: 0,
}

const DEFAULT_GAS_PRICES: TickerGasPrices = { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: '£' }

// Same publicConfig.ts cafeSettings.ticker* (DB-column-named) -> CafeTicker's
// own unprefixed TickerStyle mapping CafeTemplate.tsx already does.
function tickerStyleFromApi(cs: Record<string, unknown>): TickerStyle {
  return {
    backgroundColor: (cs.tickerBackgroundColor as string) ?? DEFAULT_TICKER_STYLE.backgroundColor,
    backgroundOpacity: (cs.tickerBackgroundOpacity as number) ?? DEFAULT_TICKER_STYLE.backgroundOpacity,
    heightPx: (cs.tickerHeightPx as number) ?? DEFAULT_TICKER_STYLE.heightPx,
    fontFamily: (cs.tickerFontFamily as TickerStyle['fontFamily']) ?? DEFAULT_TICKER_STYLE.fontFamily,
    fontSizePx: (cs.tickerFontSizePx as number) ?? DEFAULT_TICKER_STYLE.fontSizePx,
    fontColor: (cs.tickerFontColor as string) ?? DEFAULT_TICKER_STYLE.fontColor,
    scrollSpeedPxPerSec: (cs.tickerScrollSpeedPxPerSec as number) ?? DEFAULT_TICKER_STYLE.scrollSpeedPxPerSec,
    gapPx: (cs.tickerGapPx as number) ?? DEFAULT_TICKER_STYLE.gapPx,
  }
}

// Renders nothing at all (not an empty box) while disabled or still
// loading - no space reserved, matching CafeTemplate.tsx's own "fully
// collapses when off" ticker wrapper. Must be rendered inside a
// `position: relative` ancestor (the caller's own outer padded div) AND
// inside a <WeatherProvider> (every real caller - DashboardPage.tsx,
// TenantDisplayPage.tsx - already wraps every template in one).
export default function FooterTicker(): JSX.Element | null {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  const [tickerEnabled, setTickerEnabled] = useState(false)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>([])
  const [tickerStyle, setTickerStyle] = useState<TickerStyle>(DEFAULT_TICKER_STYLE)
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])
  const [gasPrices, setGasPrices] = useState<TickerGasPrices>(DEFAULT_GAS_PRICES)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (data.cafeSettings) {
          setTickerEnabled(!!data.cafeSettings.tickerEnabled)
          setTickerSlots(Array.isArray(data.cafeSettings.tickerSlots) ? data.cafeSettings.tickerSlots : [])
          setTickerStyle(tickerStyleFromApi(data.cafeSettings))
        }
        if (data.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
        if (data.gasPrices) setGasPrices(data.gasPrices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!tickerEnabled) return null

  return (
    <div
      className="absolute z-10 overflow-hidden"
      style={{
        left: `calc(-1 * ${TEMPLATE_EDGE_PADDING})`,
        right: `calc(-1 * ${TEMPLATE_EDGE_PADDING})`,
        bottom: `calc(-1 * ${TEMPLATE_EDGE_PADDING})`,
      }}
    >
      <CafeTicker
        slots={tickerSlots}
        weather={weather}
        liveDataUnavailable={liveDataUnavailable}
        visibilityHours={visibilityHours}
        safetyNotices={safetyNotices}
        gasPrices={gasPrices}
        style={tickerStyle}
      />
    </div>
  )
}
