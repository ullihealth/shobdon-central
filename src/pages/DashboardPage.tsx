import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import CentreDisplayPanel from '../components/CentreDisplayPanel'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherStatusIndicator from '../components/WeatherStatusIndicator'
import { WeatherProvider } from '../context/WeatherContext'
import { THEME_URL } from '../config/captureEndpoint'

export default function DashboardPage(): JSX.Element {
  // Active theme, synced across every device via the Worker/KV. Absent a
  // fetched override, the committed :root defaults apply naturally - no
  // fallback object needed here, since :root already equals CURRENT_LIVE_THEME.
  const [themeOverride, setThemeOverride] = useState<CSSProperties>({})

  useEffect(() => {
    let cancelled = false

    fetch(THEME_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((tokens) => {
        if (!cancelled && tokens) setThemeOverride(tokens as CSSProperties)
      })
      .catch(() => {
        // Worker unreachable - fall through to the committed :root defaults.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <WeatherProvider>
      <div
        className="h-screen w-screen overflow-hidden bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100"
        style={themeOverride}
      >
        <div
          className="mx-auto h-full max-w-[1920px] p-10"
          style={{ display: 'grid', gridTemplateRows: '7% 1fr', gap: '16px' }}
        >
          {/* HEADER (10%) */}
          <Header rightSlot={<WeatherStatusIndicator />} />

          {/* BODY (90%) - three columns left/center/right */}
          <div style={{ display: 'grid', gridTemplateColumns: '23% 54% 23%', gap: '16px', height: '100%' }}>
            <div className="h-full">
              <LeftInfoPanel />
            </div>

            <div className="h-full">
              <CentreDisplayPanel />
            </div>

            <div className="h-full">
              <RightInfoPanel />
            </div>
          </div>
        </div>
      </div>
    </WeatherProvider>
  )
}
