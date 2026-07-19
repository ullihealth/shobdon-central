import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import MediaPanel from '../media/MediaPanel'
import CafeTicker, { type TickerSlot } from '../CafeTicker'
import VenueCornerBadge from '../VenueCornerBadge'
import { currentMedia } from '../../config/media'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import { useWeather } from '../../context/WeatherContext'
import { useVisibilityForecast } from '../../services/visibilityForecastService'
import { useIsDesktopLayout } from '../../hooks/useIsDesktopLayout'

interface CafeTemplateProps {
  themeOverride: CSSProperties
  airfieldName?: string | null
  logoUrl?: string | null
}

interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

interface CafeSettings {
  layoutMode: 'split' | 'full'
  adLabelEnabled: boolean
  tickerEnabled: boolean
  tickerSlots: TickerSlot[]
}

const DEFAULT_CAFE_SETTINGS: CafeSettings = {
  layoutMode: 'full',
  adLabelEnabled: false,
  tickerEnabled: false,
  tickerSlots: Array.from({ length: 10 }, (_, i) => ({ position: i + 1, type: null })),
}

function AdLabel(): JSX.Element {
  return (
    <div className="absolute right-2 top-2 z-10 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
      Advertisement
    </div>
  )
}

// "Café Template" (registry id 'cafe-1') - one flexible template with a
// split-pane/full-16:9 toggle, not two separate templates, plus a
// footer ticker. Self-contained fetch of PUBLIC_CONFIG_URL for
// cafeSettings/safetyNotices, matching MediaPanel.tsx/LeftInfoPanel.tsx's
// already-established "each panel independently fetches what it needs"
// convention rather than threading more props through DashboardPage.tsx.
export default function CafeTemplate({ themeOverride, airfieldName, logoUrl }: CafeTemplateProps): JSX.Element {
  const isDesktop = useIsDesktopLayout()
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  const [cafeSettings, setCafeSettings] = useState<CafeSettings>(DEFAULT_CAFE_SETTINGS)
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (data.cafeSettings) setCafeSettings(data.cafeSettings)
        if (data.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const { layoutMode, adLabelEnabled, tickerEnabled, tickerSlots } = cafeSettings

  return (
    <div
      className={`w-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100 ${
        isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen overflow-y-auto'
      }`}
      style={{ ...themeOverride, padding: 'clamp(12px, 3vmin, 48px)' }}
    >
      <div
        className={isDesktop ? 'h-full' : ''}
        style={
          isDesktop
            ? { display: 'grid', gridTemplateRows: tickerEnabled ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '16px' }
            : { display: 'flex', flexDirection: 'column', gap: '16px' }
        }
      >
        {/* MAIN AREA - split-pane or full-16:9, both built from the same
            existing MediaPanel/carousel component per the layout toggle. */}
        <div className="relative min-h-0">
          <div className="absolute left-0 top-0 z-10">
            <VenueCornerBadge airfieldName={airfieldName} logoUrl={logoUrl} />
          </div>

          {layoutMode === 'split' ? (
            <div
              className={isDesktop ? 'h-full' : ''}
              style={
                isDesktop
                  ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }
                  : { display: 'flex', flexDirection: 'column', gap: '16px' }
              }
            >
              <div className={`relative ${isDesktop ? 'h-full' : ''} flex items-center justify-center overflow-hidden`}>
                <MediaPanel item={currentMedia} zone="left" />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className={`relative ${isDesktop ? 'h-full' : ''} flex items-center justify-center overflow-hidden`}>
                <MediaPanel item={currentMedia} zone="right" />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className={`relative ${isDesktop ? 'h-full' : ''} flex items-center justify-center overflow-hidden`}>
              <MediaPanel item={currentMedia} />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {/* FOOTER TICKER - fully collapses (not just hidden) when off, so
            no empty space is reserved for it. */}
        {tickerEnabled && (
          <div className="h-14 flex-shrink-0 sm:h-16">
            <CafeTicker
              slots={tickerSlots}
              weather={weather}
              liveDataUnavailable={liveDataUnavailable}
              visibilityHours={visibilityHours}
              safetyNotices={safetyNotices}
            />
          </div>
        )}
      </div>
    </div>
  )
}
