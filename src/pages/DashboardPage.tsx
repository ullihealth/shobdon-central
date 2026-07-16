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
          className="h-full"
          // Was mx-auto max-w-[1920px] - a resolution-specific cap left over
          // from this page's original hardcoded layout, predating every
          // fluid-scaling fix in this series. It only ever engaged above
          // 1920px width (so 1080p/720p/768p never revealed it), and since
          // it constrained WIDTH but not HEIGHT, a 4K screen got squeezed
          // into an unusually narrow, unusually TALL column shape - shown
          // by direct measurement to be the actual cause of the Cloud Base
          // Forecast chart rendering as a squashed sliver at 4K: the chart
          // itself scales correctly to whatever box it's given, but the cap
          // was handing it a box far more extreme (portrait) than its
          // viewBox or any resolution below 1920px wide ever produced.
          // Removed rather than patched around, matching this series' own
          // constraint that nothing should be tuned to a specific
          // resolution - every column here is already percentage/fr-based,
          // so the layout is correct by construction at any width without
          // an artificial ceiling.
          // minmax(0, 1fr), not bare 1fr - a bare 1fr row implicitly means
          // minmax(auto, 1fr), which refuses to shrink below its content's
          // own minimum height. At short browser-window heights that let
          // this row overflow h-screen's fixed height, CompassPanel (a
          // flex-shrink-0 child further down the tree) got silently
          // clipped by the page's overflow-hidden with no scrollbar to
          // reveal it - same root cause min-h-0 already fixes for flex
          // elsewhere in this codebase (e.g. CentreDisplayPanel.tsx).
          // Third row added ('auto') for the small "Powered by Airfield
          // Central" footer link below - sized to its own tiny content,
          // not a fixed px guess, so it costs the body row exactly as
          // much space as it actually needs and nothing more. minmax(0,
          // 1fr) on the body row (unchanged) is what makes this safe: it
          // shrinks to absorb the new row rather than overflowing, the
          // same "won't clip below content" fix already relied on
          // elsewhere in this layout.
          style={{ display: 'grid', gridTemplateRows: '7% minmax(0, 1fr) auto', gap: '16px' }}
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
            // fr, not %, for the columns - grid gap is added ON TOP of
            // percentage tracks (23%+54%+23% = 100% of the container, then
            // two 16px gaps are inserted in addition to that, making the
            // grid's real content 32px wider than its own container). Grid
            // overflows to the end (right, in LTR) by default, so that 32px
            // silently ate into the right column's own safe-area padding at
            // every resolution - measured directly: 0.4px of right margin
            // left over at 1920x1080 (vs. the left column's correct
            // 32.4px), and actually negative (-8.95px, genuinely off-
            // screen) at 1366x768. fr tracks divide up the space that's
            // LEFT after gaps are subtracted, so 23fr/54fr/23fr gives the
            // exact same 23/54/23 proportion the percentages intended, but
            // gap-aware by construction at any resolution - not a value
            // tuned to the resolutions this was tested at.
              display: 'grid',
              gridTemplateColumns: '23fr 54fr 23fr',
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

          {/* FOOTER - small, deliberately unobtrusive "powered by" credit.
              This renders on the clubhouse TV too, so it stays tiny and
              low-opacity rather than competing with the actual weather/ops
              content above it - legible if someone looks, not something
              that draws the eye. Opens in a new tab: this page is a kiosk
              display as much as anything else, and clicking through
              shouldn't navigate the display itself away from the
              dashboard. */}
          <div className="flex items-center justify-center pt-1">
            <a
              href="https://airfieldcentral.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-slate-400 opacity-50 transition hover:opacity-90"
            >
              <img src="/favicon/favicon-32.png" alt="" className="h-3 w-3" />
              <span>Powered by Airfield Central</span>
            </a>
          </div>
        </div>
      </div>
    </WeatherProvider>
  )
}
