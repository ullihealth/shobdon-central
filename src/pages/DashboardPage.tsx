import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import CentreDisplayPanel from '../components/CentreDisplayPanel'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherStatusIndicator from '../components/WeatherStatusIndicator'
import { WeatherProvider } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'

export default function DashboardPage(): JSX.Element {
  // Active theme, synced across every device via the tenant-scoped D1
  // config (was the Worker's global theme KV key - see
  // functions/api/public/[tenant]/config.ts). Absent a fetched override,
  // the committed :root defaults apply naturally - no fallback object
  // needed here, since :root already equals CURRENT_LIVE_THEME. No auth
  // on this fetch deliberately - this is the live public dashboard,
  // unauthenticated for everyone, same as today.
  const [themeOverride, setThemeOverride] = useState<CSSProperties>({})

  useEffect(() => {
    let cancelled = false

    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.theme) setThemeOverride(data.theme as CSSProperties)
      })
      .catch(() => {
        // Endpoint unreachable - fall through to the committed :root defaults.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <WeatherProvider>
      <div
        className="h-screen w-screen overflow-hidden bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100"
        // Safe-area/overscan margin, not a design choice - TVs commonly
        // crop a few percent off every edge of what the browser reports
        // as "the viewport" (overscan), and this varies by TV model/
        // firmware, not something knowable in advance for a SaaS product
        // running on whatever screen a given tenant plugs in. vmin (not
        // vw/vh alone) keeps the margin proportionally consistent on both
        // axes regardless of aspect ratio; clamp() keeps it from becoming
        // silly on a tiny phone or enormous on an 8K display. Was a fixed
        // p-10 (40px) on the inner content div only, which was neither
        // resolution-relative nor did anything for genuine edge-of-panel
        // overscan cropping - moved out to here, wrapping everything.
        style={{ ...themeOverride, padding: 'clamp(12px, 3vmin, 48px)' }}
      >
        <div
          className="mx-auto h-full max-w-[1920px]"
          // minmax(0, 1fr), not bare 1fr - a bare 1fr row implicitly means
          // minmax(auto, 1fr), which refuses to shrink below its content's
          // own minimum height. At short browser-window heights that let
          // this row overflow h-screen's fixed height, CompassPanel (a
          // flex-shrink-0 child further down the tree) got silently
          // clipped by the page's overflow-hidden with no scrollbar to
          // reveal it - same root cause min-h-0 already fixes for flex
          // elsewhere in this codebase (e.g. CentreDisplayPanel.tsx).
          style={{ display: 'grid', gridTemplateRows: '7% minmax(0, 1fr)', gap: '16px' }}
        >
          {/* HEADER (10%) */}
          <Header rightSlot={<WeatherStatusIndicator />} />

          {/* BODY (90%) - three columns left/center/right. gridTemplateRows
              wasn't set at all here previously - an unset row defaults to
              grid-auto-rows: auto, which has the exact same "won't shrink
              below content" behaviour as a bare 1fr (confirmed by direct
              measurement: fixing only the outer row above left this row
              still stuck at a content-driven floor height). An explicit
              minmax(0, 1fr) row makes it shrinkable too. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '23% 54% 23%',
              gridTemplateRows: 'minmax(0, 1fr)',
              gap: '16px',
              height: '100%',
            }}
          >
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
