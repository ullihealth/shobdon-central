import { useEffect, useState } from 'react'
import CafeTicker, { type TickerGasPrices, type TickerSlot, type TickerStyle } from './CafeTicker'
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
// component doesn't need.
//
// Does NOT position itself (no position:absolute/inset here) - that's
// deliberately the CALLER's job now (each of the three templates wraps
// this in their own bottom-anchored stack alongside the "Powered by"
// credit line - see e.g. Clubhouse1Template.tsx's own comment on why).
// An earlier version of this file did its own absolute positioning
// directly, which meant "Powered by" (a separate, always-rendered grid
// row) had no way to know how tall this ticker currently is, so it
// couldn't reliably avoid being visually covered by it - a z-index fix
// alone technically painted "Powered by" on top, but the ticker's own
// much bigger/bolder/brighter scrolling text still visually dominated
// the same screen region, leaving the credit line practically illegible
// (confirmed by direct screenshot, not just reasoned about). Putting
// both under one shared, auto-sized, bottom-anchored wrapper solves
// this with plain CSS document flow instead - "Powered by" simply
// renders before this component in that shared wrapper, so it always
// ends up positioned directly above whatever this renders (or directly
// at the bottom edge, with zero gap, when this returns null) - no
// height-reporting/callback plumbing needed.
//
// Height is NOT overridden or capped here - style.heightPx (CafeTicker's
// own `height` style below) is the tenant's own Ticker Style setting,
// unchanged by this round. "Slim by default" just falls out of
// heightPx's existing 24-200px range (default now 40px) - a tenant who
// deliberately sets it larger gets exactly that, even if it then
// overlaps more of whatever panel content sits behind it (accepted
// trade-off of overlaying instead of reserving space, not something
// this component second-guesses).
interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

// heightPx/fontSizePx: 40/22 - matches tickerStyleStore.ts's own
// DEFAULT_TICKER_STYLE (see that file's comment on why this changed
// from 64/16 and why it's new-tenant-only, not retroactive). Only ever
// used here as the pre-fetch placeholder before the real PUBLIC_CONFIG_URL
// fetch resolves (a brief loading window, not the ticker's actual
// server-persisted value for any tenant).
const DEFAULT_TICKER_STYLE: TickerStyle = {
  backgroundColor: '#0f172a',
  backgroundOpacity: 100,
  heightPx: 40,
  fontFamily: 'Inter',
  fontSizePx: 22,
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
// <WeatherProvider> (every real caller - DashboardPage.tsx,
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
    // overflow-x-hidden - clips CafeTicker's deliberately wider-than-box
    // marquee track horizontally (not overflow-hidden - see
    // CafeTicker.tsx's own comment on why vertical overflow is wanted
    // here, for an oversized Font Size). No position/inset of its own
    // anymore - see this file's own top comment; the caller's shared
    // stack wrapper handles bottom-edge placement for both this and
    // "Powered by" together.
    <div className="w-full overflow-x-hidden">
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
