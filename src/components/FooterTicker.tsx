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
// is untouched - it already has this working, plus its own extra
// safetyNoticesData/gasPricesData override props this component doesn't
// need, so it keeps its own inline version rather than being refactored
// onto this one.
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
// collapses when off" ticker wrapper. Must be rendered somewhere already
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

  // min-w-0 + overflow-hidden: required on THIS wrapper, not CafeTicker's
  // own inner box - see CafeTemplate.tsx's own detailed comment on why
  // (CafeTicker's animated track is deliberately wider than the viewport
  // for a seamless marquee loop; without this, that intrinsic content
  // width wins the grid track's sizing and blows out the whole layout -
  // confirmed live there, same fix applies verbatim here).
  return (
    <div className="min-w-0 overflow-hidden">
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
