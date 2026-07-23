import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import MediaPanel from '../media/MediaPanel'
import CafeTicker, { type TickerSlot, type TickerStyle } from '../CafeTicker'
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
  // Migration 0039 (Screens Design's Branding tab) - the 'cafe'
  // brandDisplay slice, passed straight through to VenueCornerBadge.tsx.
  // See that file's own comment for the full reasoning.
  showLogo?: boolean
  showName?: boolean
  nameFontSize?: 'sm' | 'md' | 'lg' | 'xl'
  // See Clubhouse1Template.tsx's own comment - same preview-mode sizing
  // swap, needed so Screens Design's Dashboard-screen preview can
  // render this exact component when 'cafe-1' is the pending/live main
  // template (DashboardPage.tsx allows a café template on '/' too, not
  // just on the named /d/cafe-tv display). Defaults false for every
  // real caller - no behaviour change on the live dashboard or café
  // screen.
  isPreview?: boolean
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
  tickerStyle: TickerStyle
}

// Matches migration 0035's own column DEFAULTs and cafe-settings/
// index.ts's defaultSettings() - the fallback used only until the real
// fetch below resolves (or if it fails outright).
const DEFAULT_CAFE_SETTINGS: CafeSettings = {
  layoutMode: 'full',
  adLabelEnabled: false,
  tickerEnabled: false,
  tickerSlots: Array.from({ length: 10 }, (_, i) => ({ position: i + 1, type: null, enabled: true })),
  tickerStyle: {
    backgroundColor: '#0f172a',
    backgroundOpacity: 100,
    heightPx: 64,
    fontFamily: 'Inter',
    fontSizePx: 16,
    fontColor: '#ffffff',
    scrollSpeedPxPerSec: 80,
    gapPx: 0,
  },
}

// publicConfig.ts's cafeSettings.ticker* fields (DB-column-named, wire
// format shared with cafe-settings/index.ts's own API) map onto
// CafeTicker's own unprefixed TickerStyle shape - one contained mapping
// step here rather than a "ticker" prefix repeated inside a prop that's
// already named `style` on an already-named-Ticker component.
function tickerStyleFromApi(cs: Record<string, unknown>): TickerStyle {
  return {
    backgroundColor: (cs.tickerBackgroundColor as string) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.backgroundColor,
    backgroundOpacity: (cs.tickerBackgroundOpacity as number) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.backgroundOpacity,
    heightPx: (cs.tickerHeightPx as number) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.heightPx,
    fontFamily: (cs.tickerFontFamily as TickerStyle['fontFamily']) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.fontFamily,
    fontSizePx: (cs.tickerFontSizePx as number) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.fontSizePx,
    fontColor: (cs.tickerFontColor as string) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.fontColor,
    scrollSpeedPxPerSec: (cs.tickerScrollSpeedPxPerSec as number) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.scrollSpeedPxPerSec,
    gapPx: (cs.tickerGapPx as number) ?? DEFAULT_CAFE_SETTINGS.tickerStyle.gapPx,
  }
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
export default function CafeTemplate({
  themeOverride,
  airfieldName,
  logoUrl,
  showLogo,
  showName,
  nameFontSize,
  isPreview = false,
}: CafeTemplateProps): JSX.Element {
  const detectedDesktop = useIsDesktopLayout()
  const isDesktop = isPreview || detectedDesktop
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  // null (not DEFAULT_CAFE_SETTINGS) until the real fetch resolves -
  // this used to initialize straight to DEFAULT_CAFE_SETTINGS
  // (layoutMode: 'full'), which meant this component's FIRST render
  // always used to briefly show full-16:9 mode (a single, unfiltered
  // MediaPanel) regardless of what the tenant actually has saved, then
  // swap to split mode (two brand-new, zone-filtered MediaPanel
  // instances, mounted fresh with empty state) the moment the real
  // settings arrived - a genuine, code-confirmed flash-then-different-
  // content transition on every single page load for any tenant using
  // split mode. Waiting for the real value before rendering the main
  // content at all removes that transition entirely instead of
  // papering over its symptoms.
  const [cafeSettings, setCafeSettings] = useState<CafeSettings | null>(null)
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.cafeSettings) {
          const cs = data.cafeSettings
          setCafeSettings({
            layoutMode: cs.layoutMode,
            adLabelEnabled: cs.adLabelEnabled,
            tickerEnabled: cs.tickerEnabled,
            tickerSlots: cs.tickerSlots,
            tickerStyle: tickerStyleFromApi(cs),
          })
        } else {
          // Request failed, or genuinely no row yet for this tenant
          // (never visited /cafe-media) - fall back to the documented
          // defaults rather than staying stuck on the loading state
          // forever.
          setCafeSettings(DEFAULT_CAFE_SETTINGS)
        }
        if (data?.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
      })
      .catch(() => {
        if (!cancelled) setCafeSettings(DEFAULT_CAFE_SETTINGS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Same background gradient as the real content below (not a blank/
  // white flash), just without the grid/panels yet - avoids a jarring
  // colour flash on top of avoiding the wrong-content flash above.
  if (!cafeSettings) {
    return (
      <div
        className={`${isPreview ? 'h-full w-full' : 'h-screen w-screen'} bg-gradient-to-b from-page-from via-page-via to-page-to`}
        style={themeOverride}
      />
    )
  }

  const { layoutMode, adLabelEnabled, tickerEnabled, tickerSlots, tickerStyle } = cafeSettings

  return (
    <div
      className={`${
        isPreview ? 'h-full w-full overflow-hidden' : `w-screen ${isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen overflow-y-auto'}`
      } bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100`}
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
            existing MediaPanel/carousel component per the layout toggle.
            min-w-0: this div is a grid item in the outer single-column
            grid below; grid items default to min-width:auto (content-
            based), not 0 - defensive here for the same reason it's
            required on the ticker wrapper below. */}
        <div className="relative min-h-0 min-w-0">
          <div className="absolute left-0 top-0 z-10">
            <VenueCornerBadge
              airfieldName={airfieldName}
              logoUrl={logoUrl}
              showLogo={showLogo}
              showName={showName}
              nameFontSize={nameFontSize}
            />
          </div>
          {/* No weather-source badge here, unlike ClassicTemplate/
              Clubhouse1Template/Clubhouse2Template (which render
              WeatherStatusIndicator via Header's rightSlot) - it was
              added here once, briefly, "so every template shows it,"
              but that's exactly wrong for this one: it's diagnostic/
              internal information (which weather data source is live -
              ATC station vs internet fallback), useful for whoever
              operates the dashboard, not for a visitor or pilot glancing
              at the clubhouse TV. Removed deliberately, not an oversight -
              café is the one display template this should never appear
              on. */}

          {layoutMode === 'split' ? (
            <div
              className={isDesktop ? 'h-full' : ''}
              style={
                isDesktop
                  ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }
                  : { display: 'flex', flexDirection: 'column', gap: '16px' }
              }
            >
              {/* No flex/centering here - MediaPanel's `fill` prop makes it
                  a plain h-full w-full block, so it fills this grid cell
                  directly rather than letterboxing to a fixed 16:9 box
                  within it (the root cause of the reported empty-space bug -
                  see MediaPanel.tsx's own comment on `fill`).
                  aspect-video on the non-desktop branch specifically -
                  MediaPanel's own outer element is UNCONDITIONALLY h-full
                  (100%), which only resolves to a real pixel height if
                  every ancestor up the chain has an explicit height too.
                  The desktop branch provides that (h-full/height:100%
                  cascading all the way from the h-screen root). The
                  non-desktop branch deliberately does NOT (min-h-screen
                  lets the page grow and scroll instead of clipping to
                  the viewport) - so without an aspect ratio here,
                  MediaPanel's h-full resolves against an ancestor chain
                  with no real height anywhere in it, and the whole
                  panel - including whatever slot is meant to be
                  showing - collapses to zero height. aspect-video gives
                  it a real, self-contained height derived from its own
                  (reliably available, since this IS a flex-column with
                  real width) width instead, sidestepping the percentage-
                  height chain entirely. */}
              <div className={`relative overflow-hidden ${isDesktop ? 'h-full' : 'aspect-video'}`}>
                <MediaPanel item={currentMedia} zone="left" fill slotSource="cafe" />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className={`relative overflow-hidden ${isDesktop ? 'h-full' : 'aspect-video'}`}>
                <MediaPanel item={currentMedia} zone="right" fill slotSource="cafe" />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            // Full 16:9 mode deliberately reuses Dashboard Manager's own
            // proven rendering path verbatim - not the `fill`-based
            // approach above (that's what four rounds of unresolved
            // split-pane debugging couldn't fully explain; `fill` is a
            // codepath the "confirmed working, never had an issue"
            // dashboard carousel has NEVER actually exercised - only
            // café and admin previews ever pass it). This is the exact
            // same invocation ClassicTemplate.tsx/CentreDisplayPanel.tsx
            // use for the real, always-worked dashboard carousel -
            // MediaPanel with no `fill`, no `zone`, just its own default
            // aspect-video box, centred in a simple flex container -
            // the ONLY difference from dashboard's own call is
            // slotSource="cafe", the one parameter that was already
            // generalized for exactly this purpose. Trade-off, stated
            // plainly: this can letterbox (empty side gaps) at very wide
            // aspect ratios, the exact visual issue `fill` was
            // originally built to avoid - accepted deliberately this
            // round in exchange for using code with an actual track
            // record, rather than continuing to debug code that hasn't
            // earned one. Split-pane above is untouched and still uses
            // `fill` - explicitly out of scope this round.
            <div className="relative flex items-center justify-center overflow-hidden" style={isDesktop ? { height: '100%' } : undefined}>
              <MediaPanel item={currentMedia} slotSource="cafe" />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {/* FOOTER TICKER - fully collapses (not just hidden) when off, so
            no empty space is reserved for it. No fixed height wrapper
            here anymore - CafeTicker sets its own height from
            tickerStyle.heightPx (Phase 2 style controls).
            overflow-hidden + min-w-0: this wrapper is the actual grid
            item in the outer single-column grid above (CafeTicker's own
            div is just its child) - grid items default to
            min-width:auto, i.e. sized to fit their content's intrinsic
            (min-content) width, not 0. CafeTicker's animated track is
            deliberately width:max-content with its segment list
            duplicated for a seamless marquee loop, so its intrinsic
            content width is routinely 2x+ the viewport - without
            overriding the default here, THAT width was winning the
            grid track's sizing, pushing the whole outer frame wider
            than the screen (confirmed live: toggling the ticker off
            alone made the whole frame render correctly, ticker back on
            broke it immediately, independent of anything media-panel-
            related). CafeTicker's own overflow-hidden only clips ITS
            OWN box visually - it doesn't stop this ancestor grid item
            from being sized by that content in the first place. */}
        {tickerEnabled && (
          <div className="min-w-0 overflow-hidden">
            <CafeTicker
              slots={tickerSlots}
              weather={weather}
              liveDataUnavailable={liveDataUnavailable}
              visibilityHours={visibilityHours}
              safetyNotices={safetyNotices}
              style={tickerStyle}
            />
          </div>
        )}
      </div>
    </div>
  )
}
