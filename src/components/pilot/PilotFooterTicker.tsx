import { useEffect, useState } from 'react'
import CafeTicker, { type TickerGasPrices, type TickerSlot, type TickerStyle } from '../CafeTicker'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import { useWeather } from '../../context/WeatherContext'
import { useVisibilityForecast } from '../../services/visibilityForecastService'

// Pilot View sticky ticker (Section 10) - a SEPARATE ticker config from
// the café template's own FooterTicker.tsx (reads cafeSettings.
// tickerSlots), sourced from tenants.pilot_ticker_slots_json instead
// (publicConfig.ts's pilotTicker.slots) - different audience/page,
// independently configurable per the approved plan. CafeTicker itself
// is reused completely unmodified as the renderer; only the data source
// differs from FooterTicker.tsx. Does NOT self-position (same as
// CafeTicker/FooterTicker) - PilotViewPage.tsx wraps this in its own
// sticky-bottom container.
interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

// Exported so PilotTickerSlotsEditor.tsx can show this same fontColor as
// its per-slot swatch's "inherited" default - this editor has no
// tickerStyle state of its own (Pilot View's ticker style is otherwise
// fixed, not per-tenant configurable), so this is the one real source of
// truth for what an unset slot colour actually renders as.
export const DEFAULT_TICKER_STYLE: TickerStyle = {
  backgroundColor: '#0f172a',
  backgroundOpacity: 100,
  heightPx: 36,
  fontFamily: 'Inter',
  fontSizePx: 15,
  fontColor: '#ffffff',
  scrollSpeedPxPerSec: 60,
  gapPx: 0,
}

const DEFAULT_GAS_PRICES: TickerGasPrices = { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: '£' }

function hasRealContent(slots: TickerSlot[]): boolean {
  return slots.some((slot) => slot.enabled !== false && ((slot.textMode && slot.manualText?.trim()) || (!slot.textMode && slot.type)))
}

export default function PilotFooterTicker(): JSX.Element | null {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>([])
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])
  const [gasPrices, setGasPrices] = useState<TickerGasPrices>(DEFAULT_GAS_PRICES)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.pilotTicker?.slots)) setTickerSlots(data.pilotTicker.slots)
        if (data.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
        if (data.gasPrices) setGasPrices(data.gasPrices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!hasRealContent(tickerSlots)) return null

  return (
    <div className="w-full overflow-x-hidden">
      <CafeTicker
        slots={tickerSlots}
        weather={weather}
        liveDataUnavailable={liveDataUnavailable}
        visibilityHours={visibilityHours}
        safetyNotices={safetyNotices}
        gasPrices={gasPrices}
        style={DEFAULT_TICKER_STYLE}
      />
    </div>
  )
}
