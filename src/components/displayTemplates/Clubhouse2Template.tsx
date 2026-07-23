import type { CSSProperties } from 'react'
import CloudVisibilityChart from '../CloudVisibilityChart'
import CompassPanel from '../CompassPanel'
import Header from '../Header'
import LeftInfoPanel, { type OpsPanelChartConfig } from '../LeftInfoPanel'
import MediaPanel, { type MediaPanelSourceData } from '../media/MediaPanel'
import RightInfoPanel, { type OpsPanelPublic } from '../RightInfoPanel'
import WeatherStatusIndicator from '../WeatherStatusIndicator'
import { currentMedia } from '../../config/media'
import { useWeather } from '../../context/WeatherContext'
import { useVisibilityForecast } from '../../services/visibilityForecastService'
import { estimateCloudBaseFt } from '../../utils/cloudBase'
import { useIsDesktopLayout } from '../../hooks/useIsDesktopLayout'

interface Clubhouse2TemplateProps {
  themeOverride: CSSProperties
  airfieldName?: string | null
  logoUrl?: string | null
  // Migration 0039 (Screens Design's Branding tab) - the 'main'
  // brandDisplay slice, passed straight through to Header.tsx. See that
  // file's own comment for the full reasoning.
  showLogo?: boolean
  showName?: boolean
  nameFontSize?: 'sm' | 'md' | 'lg' | 'xl'
  // See Clubhouse1Template.tsx's own comment - same preview-mode sizing
  // swap (w-full/h-full instead of w-screen/h-screen, forced desktop
  // layout), needed for Screens Design's live preview to embed this
  // exact component inside its fixed-size scaled box. Defaults false
  // for every real caller - no behaviour change on the live dashboard.
  isPreview?: boolean
  // See Clubhouse1Template.tsx's own comment on these three - same
  // pass-through-to-avoid-self-fetch reasoning, same components
  // (MediaPanel, RightInfoPanel, LeftInfoPanel) rendered here too.
  mediaData?: MediaPanelSourceData
  opsPanelData?: OpsPanelPublic | null
  opsPanelChartData?: OpsPanelChartConfig | null
}

// "Clubhouse Template 2" - a fixed (not carousel), upper/lower split
// alternative to Template 1. Upper half: 6-hour Met Office forecast |
// video-forward media | fixed NOTAMS, side by side. Lower
// half: the existing stat panels (wind/QNH/temperature/cloud base/
// visibility via LeftInfoPanel, compass via CompassPanel), both with
// their own internal auto-flip disabled so everything on screen stays
// simultaneously visible - "more fixed, less carousel" than Template 1,
// per its own layout spec. Built entirely from existing components via
// small additive props (preferVideo/notamsOnly/disableChartFlip - see
// each component's own comment), no new data plumbing.
export default function Clubhouse2Template({
  themeOverride,
  airfieldName,
  logoUrl,
  showLogo,
  showName,
  nameFontSize,
  isPreview = false,
  mediaData,
  opsPanelData,
  opsPanelChartData,
}: Clubhouse2TemplateProps): JSX.Element {
  const detectedDesktop = useIsDesktopLayout()
  const isDesktop = isPreview || detectedDesktop

  // Same small derivation LeftInfoPanel.tsx already does to feed its own
  // internal CloudVisibilityChart instance (State B) - reused directly
  // here rather than through a new shared hook, matching this codebase's
  // own established "near-duplicate template code, not a shared
  // extraction" precedent (see ClassicTemplate.tsx's own comment on why
  // it doesn't import DashboardPage's JSX either).
  const { weather, liveDataUnavailable, activeProvider } = useWeather()
  const { hours: visibilityHours, fetchedAt: visibilityFetchedAt } = useVisibilityForecast()
  const cloudBaseFt =
    !weather || liveDataUnavailable || activeProvider !== 'atc' || weather.dewpoint === undefined
      ? null
      : estimateCloudBaseFt(weather.temperature, weather.dewpoint)
  const cloudBaseCapturedAt = cloudBaseFt === null ? null : (weather?.capturedAt ?? null)

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
            ? { display: 'grid', gridTemplateRows: '7% minmax(0, 1fr) auto', gap: '16px' }
            : { display: 'flex', flexDirection: 'column', gap: '16px' }
        }
      >
        <div style={isDesktop ? undefined : { height: '64px', flexShrink: 0 }}>
          <Header
            airfieldName={airfieldName}
            logoUrl={logoUrl}
            showLogo={showLogo}
            showName={showName}
            nameFontSize={nameFontSize}
            rightSlot={<WeatherStatusIndicator />}
          />
        </div>

        {/* BODY - upper half / fixed divider / lower half. minmax(0,1fr) on
            both halves (not bare 1fr) so each can genuinely shrink below
            its content's own height, same anti-clipping reasoning used
            throughout this codebase's other templates. */}
        <div
          style={
            isDesktop
              ? // Lower half gets more than half the body height, not an
                // even split - it holds 5 stat cards + compass (genuine
                // vertical room needed), while the upper half's media
                // panel is aspect-video-capped and its other two panels
                // are comparatively compact. Confirmed via screenshot at
                // 1280x720 (the tightest standard resolution) that an
                // even split overflowed the lower half's own content.
                { display: 'grid', gridTemplateRows: 'minmax(0, 38fr) auto minmax(0, 62fr)', gap: '16px', height: '100%' }
              : { display: 'flex', flexDirection: 'column', gap: '16px' }
          }
        >
          {/* UPPER HALF - forecast | video-forward media | fixed notices */}
          <div
            style={
              isDesktop
                ? { display: 'grid', gridTemplateColumns: '30fr 40fr 30fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }
                : { display: 'flex', flexDirection: 'column', gap: '16px' }
            }
          >
            <div className={isDesktop ? 'h-full' : ''}>
              <div className="flex h-full flex-col rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
                <div className="mb-5 flex-shrink-0 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">
                  6-Hour Forecast
                </div>
                <div className="min-h-0 flex-1">
                  <CloudVisibilityChart
                    cloudBaseFt={cloudBaseFt}
                    cloudBaseCapturedAt={cloudBaseCapturedAt}
                    visibilityHours={visibilityHours}
                    visibilityFetchedAt={visibilityFetchedAt}
                  />
                </div>
              </div>
            </div>

            <div className={`flex items-center justify-center overflow-hidden ${isDesktop ? 'h-full' : ''}`}>
              <MediaPanel item={currentMedia} preferVideo data={mediaData} />
            </div>

            <div className={isDesktop ? 'h-full' : ''}>
              <RightInfoPanel notamsOnly opsPanelData={opsPanelData} />
            </div>
          </div>

          {/* DIVIDER - a clear, fixed horizontal line splitting upper/lower.
              A deliberate few-px hairline, not clamp()-scaled: dividers
              read the same relative thickness at any resolution, unlike
              meaningful content dimensions elsewhere in this layout. */}
          <div className="h-[3px] flex-shrink-0 rounded-full bg-border" />

          {/* LOWER HALF - existing stat panels side by side, both fixed
              (disableChartFlip / CompassPanel has no carousel of its own) -
              "more fixed, less carousel" than Template 1. */}
          <div
            style={
              isDesktop
                ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }
                : { display: 'flex', flexDirection: 'column', gap: '16px' }
            }
          >
            <div className={isDesktop ? 'h-full' : ''}>
              <LeftInfoPanel disableChartFlip compactStats opsPanelChartData={opsPanelChartData} />
            </div>

            <div className={isDesktop ? 'h-full' : ''}>
              <CompassPanel />
            </div>
          </div>
        </div>

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
  )
}
