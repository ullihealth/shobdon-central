import type { CSSProperties } from 'react'
import CentreDisplayPanel from '../CentreDisplayPanel'
import Header from '../Header'
import LeftInfoPanel, { type OpsPanelChartConfig } from '../LeftInfoPanel'
import RightInfoPanel, { type OpsPanelPublic } from '../RightInfoPanel'
import WeatherStatusIndicator from '../WeatherStatusIndicator'
import type { MediaPanelSourceData } from '../media/MediaPanel'
import { useIsDesktopLayout } from '../../hooks/useIsDesktopLayout'

interface Clubhouse1TemplateProps {
  themeOverride: CSSProperties
  airfieldName?: string | null
  logoUrl?: string | null
  // Migration 0039 (Screens Design's Branding tab) - the 'main'
  // brandDisplay slice, passed straight through to Header.tsx. See that
  // file's own comment for the full reasoning.
  showLogo?: boolean
  showName?: boolean
  nameFontSize?: 'sm' | 'md' | 'lg' | 'xl'
  // Screens Design's live preview renders this exact component (not a
  // lookalike) inside a fixed-size scaled box, not the real page -
  // w-screen/h-screen would size against the actual browser viewport
  // instead of that box, breaking the scale-transform the preview
  // relies on. true swaps to w-full/h-full and forces the desktop
  // (3-column) branch regardless of the real viewport width - matching
  // what the preview's own reference dimensions already assume, since
  // there's no "mobile preview" mode today. Defaults false/undefined
  // for every real caller (DashboardPage.tsx) - zero behaviour change
  // on the actual live dashboard.
  isPreview?: boolean
  // Passed straight through to CentreDisplayPanel/RightInfoPanel/
  // LeftInfoPanel's own equivalent props - see MediaPanel.tsx's `data`
  // prop comment for the full story (an authenticated admin preview's
  // session-switched org can differ from the browser's current
  // subdomain, which is what these components' self-fetches otherwise
  // resolve by). Every existing caller (DashboardPage.tsx, the real
  // public dashboard) omits all three and is unaffected.
  mediaData?: MediaPanelSourceData
  opsPanelData?: OpsPanelPublic | null
  opsPanelChartData?: OpsPanelChartConfig | null
}

// "Clubhouse Template 1" - the dashboard layout that was DashboardPage.tsx's
// entire own JSX prior to the template-selector work, extracted here
// VERBATIM (byte-for-byte, verified via before/after Playwright screenshot
// diff at all 4 standard resolutions) so it becomes the first of 5
// selectable templates without changing anything about how it looks or
// behaves. DashboardPage.tsx itself is now a thin dispatcher (fetch +
// unavailable/WeatherProvider handling only) choosing between this and
// Clubhouse2Template based on the tenant's mainTemplateId - same dispatch
// shape TenantDisplayPage.tsx already uses for ClassicTemplate/
// CafeTemplate. No panelConfig prop here (unlike ClassicTemplate) -
// this template has never had conditional panels and must not gain any,
// per the "no visual changes, just formalize it" requirement.
export default function Clubhouse1Template({
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
}: Clubhouse1TemplateProps): JSX.Element {
  const detectedDesktop = useIsDesktopLayout()
  const isDesktop = isPreview || detectedDesktop

  return (
    <div
      className={`${
        isPreview ? 'h-full w-full overflow-hidden' : `w-screen ${isDesktop ? 'h-screen overflow-hidden' : 'min-h-screen overflow-y-auto'}`
      } bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100`}
      // Safe-area/overscan margin, not a design choice - TVs commonly
      // crop a few percent off every edge of what the browser reports
      // as "the viewport" (overscan), and this varies by TV model/
      // firmware, not something knowable in advance for a SaaS product
      // running on whatever screen a given tenant plugs in. vmin (not
      // vw/vh alone) keeps the margin proportionally consistent on both
      // axes regardless of aspect ratio; clamp() keeps it from becoming
      // silly on a tiny phone or enormous on an 8K display.
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
        {/* HEADER (10%). Fixed height below md (not auto/flex-shrink) -
            Header's own content assumes a real box to centre the
            clock/status slot within; a stacked flex-column layout
            otherwise gives it only as much height as its content
            strictly needs, which clipped the clock in testing. */}
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

        {/* BODY (90%) - three columns left/center/right. */}
        <div
          style={
            isDesktop
              ? {
                  // fr, not %, for the columns - grid gap is added ON TOP of
                  // percentage tracks. fr tracks divide up the space that's
                  // LEFT after gaps are subtracted, so 23fr/54fr/23fr gives
                  // the exact same 23/54/23 proportion the percentages
                  // intended, but gap-aware by construction at any resolution.
                  display: 'grid',
                  gridTemplateColumns: '23fr 54fr 23fr',
                  gridTemplateRows: 'minmax(0, 1fr)',
                  gap: '16px',
                  height: '100%',
                }
              : // Below md: stacked, natural height per panel, page scrolls.
                { display: 'flex', flexDirection: 'column', gap: '16px' }
          }
        >
          <div className={isDesktop ? 'h-full' : ''}>
            <LeftInfoPanel opsPanelChartData={opsPanelChartData} />
          </div>

          <div className={isDesktop ? 'h-full' : ''}>
            <CentreDisplayPanel mediaData={mediaData} />
          </div>

          <div className={isDesktop ? 'h-full' : ''}>
            <RightInfoPanel opsPanelData={opsPanelData} />
          </div>
        </div>

        {/* FOOTER - small, deliberately unobtrusive "powered by" credit. */}
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
