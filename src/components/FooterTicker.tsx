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
// component doesn't need - but DOES need the exact same overlay
// positioning below, hand-mirrored there rather than imported (it
// doesn't use this component at all, matching this codebase's existing
// "hand-mirrored café JSX" precedent - see CafeTemplate.tsx's own
// comment).
//
// Overlay positioning (was a reserved grid row until this round): an
// absolutely-positioned element's containing block is its nearest
// `position: relative` ancestor's PADDING BOX - which is bounded by
// that ancestor's own OUTER edge (border-box minus border-width, which
// here has no border), not narrowed by the ancestor's own `padding`
// property at all. So `left/right/bottom: 0` already lands exactly on
// the template's true outer edge, padding notwithstanding - no extra
// offset needed. (An earlier version of this file used
// `calc(-1 * TEMPLATE_EDGE_PADDING)` on the theory that 0 would land on
// the INSET content edge instead - confirmed wrong by direct
// measurement: that push the ticker's own bottom edge accordingly far
// PAST the true screen edge, off the actual visible display, silently
// cropping roughly the bottom half of the bar - the real cause of the
// "text sits too low / gets clipped" bug, not a font-metrics issue.)
// Each caller (Clubhouse1Template.tsx etc.) puts `position: relative`
// on its own outermost (padded) div specifically so this positioning
// resolves against THAT box, whatever size it happens to be (the real
// screen, or - via isPreview - a small scaled preview box elsewhere),
// never the browser's true viewport. That's also why this is
// `position: absolute`, not `fixed`: fixed
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
    // overflow-x-hidden, not overflow-hidden - see CafeTicker.tsx's own
    // comment on its outer box. This wrapper has no explicit height
    // (auto, sized to CafeTicker's own box), so vertical clipping here
    // was never load-bearing for the normal case - but it WOULD re-clip
    // the deliberate vertical overflow CafeTicker.tsx now allows through
    // for an oversized Font Size, undoing that fix at this level.
    <div className="absolute inset-x-0 bottom-0 z-10 overflow-x-hidden">
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
