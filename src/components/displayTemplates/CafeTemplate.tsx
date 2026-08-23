import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import MediaPanel, { type MediaPanelSourceData } from '../media/MediaPanel'
import CafeTicker, { type TickerGasPrices, type TickerSlot, type TickerStyle } from '../CafeTicker'
import VenueCornerBadge from '../VenueCornerBadge'
import { currentMedia } from '../../config/media'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import { TEMPLATE_EDGE_PADDING } from '../../config/templateLayout'
import { useWeather } from '../../context/WeatherContext'
import { useVisibilityForecast } from '../../services/visibilityForecastService'
import { useElementHeight } from '../../hooks/useElementHeight'
import { useIsDesktopLayout } from '../../hooks/useIsDesktopLayout'
import { fetchIngestedWeather } from '../../services/weatherProviders/ingestedProvider'
import type { WeatherData } from '../../types/weather'

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
  // Passed straight through to each MediaPanel call's own `data` prop -
  // see MediaPanel.tsx's own comment for the full story (an
  // authenticated admin preview's session-switched org can differ from
  // the browser's current subdomain). Every existing caller (the real
  // public dashboard/café display) omits this and is unaffected.
  mediaData?: MediaPanelSourceData
  // Same reasoning, scoped to just the ticker's safetyNotices - this
  // component's OTHER self-fetched data (cafeSettings: layout mode, ad
  // label, ticker style) is left on its existing self-fetch for now,
  // out of this round's scope (a lower-stakes layout/style setting, not
  // real identifying tenant content like a photo or a safety notice).
  // undefined (every real public caller) leaves the self-fetched
  // notices untouched.
  safetyNoticesData?: SafetyNotice[]
  // Same reasoning/pattern as safetyNoticesData above, scoped to the
  // ticker's new gas prices addon (task #42) instead of notices. Nullable
  // (unlike safetyNoticesData) because its DesignPage.tsx caller's own
  // state is sourced directly from gas_prices' own missing-row-is-null
  // shape, not via an intermediate `?.` that would already collapse
  // null to undefined.
  gasPricesData?: TickerGasPrices | null
}

interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

const DEFAULT_GAS_PRICES: TickerGasPrices = { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: '£' }

interface CafeSettings {
  layoutMode: 'split' | 'full'
  adLabelEnabled: boolean
  tickerEnabled: boolean
  tickerSlots: TickerSlot[]
  tickerStyle: TickerStyle
}

// Matches cafe-settings/index.ts's defaultSettings() - the fallback
// used only until the real fetch below resolves (or if it fails
// outright), not any tenant's actual persisted value. heightPx/
// fontSizePx: 40/22 - see tickerStyleStore.ts's own DEFAULT_TICKER_STYLE
// comment for why this changed from 64/16 and why it's new-tenant-only.
const DEFAULT_CAFE_SETTINGS: CafeSettings = {
  layoutMode: 'full',
  adLabelEnabled: false,
  tickerEnabled: false,
  tickerSlots: Array.from({ length: 10 }, (_, i) => ({ position: i + 1, type: null, enabled: true })),
  tickerStyle: {
    backgroundColor: '#0f172a',
    backgroundOpacity: 100,
    heightPx: 40,
    fontFamily: 'Inter',
    fontSizePx: 22,
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
  mediaData,
  safetyNoticesData,
  gasPricesData,
}: CafeTemplateProps): JSX.Element {
  const detectedDesktop = useIsDesktopLayout()
  const isDesktop = isPreview || detectedDesktop
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()
  // See Clubhouse1Template.tsx's own comment (same "ticker overlay is
  // position:absolute so the grid has no natural awareness of its
  // height" issue applies here too - the media area was overflowing
  // into it at larger configured ticker heights).
  const [tickerRef, tickerHeight] = useElementHeight<HTMLDivElement>()

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
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>(safetyNoticesData ?? [])
  const [gasPrices, setGasPrices] = useState<TickerGasPrices>(gasPricesData ?? DEFAULT_GAS_PRICES)
  // Ticker weather-mirroring round - publicConfig.ts's own new
  // hasParentTenant field (effective.isInherited, the same boolean ops-
  // panel/gas-prices/runway-groups already branch on). Sourced from this
  // same self-fetch rather than a second request.
  const [hasParentTenant, setHasParentTenant] = useState(false)

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
        // Only apply the self-fetched (Host-resolved) notices when
        // safetyNoticesData wasn't explicitly provided - see that
        // prop's own comment. cafeSettings itself is deliberately still
        // always self-fetched here, out of this round's scope.
        if (safetyNoticesData === undefined && data?.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
        if (gasPricesData === undefined && data?.gasPrices) setGasPrices(data.gasPrices)
        setHasParentTenant(!!data?.hasParentTenant)
      })
      .catch(() => {
        if (!cancelled) setCafeSettings(DEFAULT_CAFE_SETTINGS)
      })
    return () => {
      cancelled = true
    }
  }, [safetyNoticesData, gasPricesData])

  // Ticker weather-mirroring round - when this tenant is parent-linked,
  // the ticker's "conditions"/"forecast" segments read the PARENT's live
  // weather instead of this tenant's own useWeather() value below,
  // reusing fetchIngestedWeather() (src/services/weatherProviders/
  // ingestedProvider.ts) completely as-is - that fetcher already calls
  // /api/public/weather-latest, which already resolves the effective
  // (parent, when linked) tenant via resolveEffectiveTenantById, the
  // exact same mirroring lookup ops-panel/gas-prices/runway-groups use
  // server-side. No new fetch/mapping logic written here at all - this
  // is that same existing provider fetcher, called directly, polled on
  // a plain interval the same way WeatherContext polls its own
  // providers. Non-parent-linked tenants (hasParentTenant false, the
  // ordinary case) never run this effect at all - their ticker keeps
  // reading useWeather() exactly as before, unchanged.
  const [inheritedWeather, setInheritedWeather] = useState<{ weather: WeatherData | null; liveDataUnavailable: boolean } | null>(null)

  useEffect(() => {
    if (!hasParentTenant) return
    let cancelled = false

    async function load() {
      try {
        const result = await fetchIngestedWeather()
        if (!cancelled) setInheritedWeather({ weather: result.data, liveDataUnavailable: false })
      } catch {
        // Parent has no ingested reading (or it's stale/missing fields) -
        // same "N/A" outcome CafeTicker.tsx's own conditionsSegmentText
        // already shows for a null/unavailable weather value, never a
        // crash or a fall-through to this tenant's own unrelated data.
        if (!cancelled) setInheritedWeather({ weather: null, liveDataUnavailable: true })
      }
    }

    load()
    const interval = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [hasParentTenant])

  // Keeps safetyNotices in sync if a parent's own already-fetched data
  // changes after this component's initial mount (e.g. DesignPage.tsx's
  // own TENANT_CONFIG_URL refetch) - the effect above only re-reads
  // safetyNoticesData on mount/dependency change via its own closure,
  // this covers the same case explicitly and cheaply.
  useEffect(() => {
    if (safetyNoticesData !== undefined) setSafetyNotices(safetyNoticesData)
  }, [safetyNoticesData])

  useEffect(() => {
    if (gasPricesData !== undefined) setGasPrices(gasPricesData ?? DEFAULT_GAS_PRICES)
  }, [gasPricesData])

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

  // Parent-linked: use the mirrored reading (inheritedWeather starts
  // null for the brief moment before its own first fetch resolves -
  // treated as unavailable rather than blocking on it, consistent with
  // every other "N/A until data arrives" ticker segment). Not linked:
  // exactly today's own useWeather() value, untouched.
  const tickerWeather = hasParentTenant ? (inheritedWeather?.weather ?? null) : weather
  const tickerLiveDataUnavailable = hasParentTenant ? (inheritedWeather?.liveDataUnavailable ?? true) : liveDataUnavailable

  return (
    <div
      className={`${
        isPreview ? 'h-full w-full overflow-hidden' : `w-screen ${isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen overflow-y-auto'}`
      } bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100`}
      // position: relative - see FooterTicker.tsx's own comment on this
      // exact mechanism (the ticker overlay below resolves its
      // negative-offset positioning against THIS box's padding edge,
      // not the true browser viewport) - same reasoning as the three
      // standard templates now use via FooterTicker, hand-mirrored here
      // since this template doesn't use that shared component.
      style={{ ...themeOverride, padding: TEMPLATE_EDGE_PADDING, position: 'relative' }}
    >
      <div
        className={isDesktop ? 'h-full' : ''}
        style={
          isDesktop
            // paddingBottom: tickerHeight - see Clubhouse1Template.tsx's
            // own comment on this same declaration (0 when the ticker's
            // off, since tickerRef then measures an empty/absent box).
            ? { display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', paddingBottom: tickerHeight }
            : { display: 'flex', flexDirection: 'column', gap: '16px' }
        }
      >
        {/* MAIN AREA - split-pane or full-16:9, both built from the same
            existing MediaPanel/carousel component per the layout toggle.
            min-w-0: this div is a grid item in the outer single-column
            grid below; grid items default to min-width:auto (content-
            based), not 0. (The ticker below is no longer a grid item at
            all as of this round - see its own comment - so this is now
            the only remaining min-w-0 in this file.) */}
        <div className="relative min-h-0 min-w-0">
          <div className="absolute left-2 top-2 z-10">
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
                <MediaPanel item={currentMedia} zone="left" fill slotSource="cafe" data={mediaData} isPreview={isPreview} />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className={`relative overflow-hidden ${isDesktop ? 'h-full' : 'aspect-video'}`}>
                <MediaPanel item={currentMedia} zone="right" fill slotSource="cafe" data={mediaData} isPreview={isPreview} />
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
              <MediaPanel item={currentMedia} slotSource="cafe" data={mediaData} isPreview={isPreview} />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

      </div>

      {/* FOOTER TICKER - fully collapses (not just hidden) when off, so
          no space is reserved for it either way. Was a reserved grid row
          (sized by tickerStyle.heightPx) until this round, which shrank
          the main media area by that much whenever the ticker was on -
          now a sibling of the grid above, absolutely positioned to
          overlay the screen's true bottom edge instead (see
          FooterTicker.tsx's own comment for the full positioning
          mechanism - inset-x-0 bottom-0, NOT a negative offset past
          those edges, since the containing block's own padding edge
          already IS the true outer edge regardless of this template's
          `padding` property - hand-mirrored here rather than reusing
          that component, since this template keeps its own inline
          fetch). No min-w-0/overflow-hidden grid-blowout concern anymore
          either - that was specifically about being a GRID ITEM (grid
          items default to min-width:auto, sized to fit CafeTicker's
          deliberately-wider-than-viewport marquee track); an absolutely
          positioned element isn't a grid item at all. overflow-x-hidden
          (not overflow-hidden - see CafeTicker.tsx's own comment on why
          vertical clipping is no longer wanted here) still clips that
          same wide marquee track horizontally. */}
      {tickerEnabled && (
        <div ref={tickerRef} className="absolute inset-x-0 bottom-0 z-10 overflow-x-hidden">
          <CafeTicker
            slots={tickerSlots}
            weather={tickerWeather}
            liveDataUnavailable={tickerLiveDataUnavailable}
            visibilityHours={visibilityHours}
            safetyNotices={safetyNotices}
            gasPrices={gasPrices}
            style={tickerStyle}
          />
        </div>
      )}
    </div>
  )
}
