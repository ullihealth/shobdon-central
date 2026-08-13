import type { CSSProperties } from 'react'
import CentreDisplayPanel from '../CentreDisplayPanel'
import FooterTicker from '../FooterTicker'
import GasPricesPanel, { type GasPricesPublic } from '../GasPricesPanel'
import Header from '../Header'
import LeftInfoPanel, { type OpsPanelChartConfig } from '../LeftInfoPanel'
import RightInfoPanel, { type OpsPanelPublic } from '../RightInfoPanel'
import WeatherStatusIndicator from '../WeatherStatusIndicator'
import type { MediaPanelSourceData } from '../media/MediaPanel'
import { TEMPLATE_EDGE_PADDING } from '../../config/templateLayout'
import { useElementHeight } from '../../hooks/useElementHeight'
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
  // Same reasoning as opsPanelData above, scoped to task #42's Gas
  // Prices tile row instead of the Ops Panel's own notices/runway state.
  gasPricesData?: GasPricesPublic | null
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
  gasPricesData,
}: Clubhouse1TemplateProps): JSX.Element {
  const detectedDesktop = useIsDesktopLayout()
  const isDesktop = isPreview || detectedDesktop
  // Measures the BOTTOM STACK's own actual rendered height (see that
  // div's own comment below) so the grid can reserve exactly that much
  // space instead of assuming it's zero - see this hook's own comment
  // for why the stack being position:absolute otherwise leaves the
  // panels grid with no idea it's there at all, which is what caused
  // panels/compass content to visually collide with "Powered by"/the
  // ticker at the bottom edge.
  const [stackRef, stackHeight] = useElementHeight<HTMLDivElement>()

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
      // position: relative - the containing block FooterTicker's own
      // negative-offset overlay positioning resolves against (see that
      // file's own comment for the full mechanism). Must be THIS div
      // (not some inner one) so the overlay breaks out past exactly the
      // padding declared here, on the real dashboard AND inside
      // DesignPage.tsx's scaled preview box alike.
      style={{ ...themeOverride, padding: TEMPLATE_EDGE_PADDING, position: 'relative' }}
    >
      <div
        className={isDesktop ? 'h-full' : ''}
        style={
          isDesktop
            // paddingBottom: stackHeight - reserves exactly as much space
            // as the bottom stack currently occupies (0 when the ticker
            // is off, since "Powered by" alone is what CentreDisplay/etc
            // already cleared before the ticker existed) so the body row
            // below shrinks by that much instead of running underneath
            // the stack. box-sizing: border-box (Tailwind's global reset)
            // is what makes this subtract from the 100% height rather
            // than add to it.
            ? { display: 'grid', gridTemplateRows: '7% minmax(0, 1fr)', gap: '16px', paddingBottom: stackHeight }
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

          {/* Ops Panel sits above Gas Prices, both sharing this one
              right-hand column (order swapped from the original Gas
              Prices-above-Ops-Panel layout - Ops Panel now renders
              first/top, Gas Prices second/bottom, per explicit
              instruction). flex-col + gap here (not two independent
              h-full siblings) is what actually "shrinks" the Ops Panel
              to its own content height - RightInfoPanel's OWN outer box
              already only sizes its content to what it needs (see that
              file's own comment on why it went from a stretched grid to
              flex-col), but this column wrapper was still pinning it to
              the FULL column height regardless. min-h-0 on the
              RightInfoPanel wrapper is required for flex-1 to actually
              shrink it below its content's natural height on a short
              viewport, rather than overflowing - same fix shape as
              CentreDisplayPanel's own flex children elsewhere on this
              page. Swapping JSX order alone is sufficient here: flex-1
              absorbs whatever space the OTHER (content-sized) sibling
              doesn't need regardless of which order the two appear in,
              so Ops Panel keeps taking the flexible remainder and Gas
              Prices keeps its own fixed content height either way - no
              other spacing/margin adjustment needed for the swap
              itself. */}
          <div className={isDesktop ? 'flex h-full flex-col gap-4' : 'flex flex-col gap-4'}>
            <div className={isDesktop ? 'min-h-0 flex-1' : ''}>
              <RightInfoPanel opsPanelData={opsPanelData} />
            </div>
            <GasPricesPanel gasPricesData={gasPricesData} />
          </div>
        </div>

      </div>

      {/* BOTTOM STACK - "Powered by" credit ALWAYS renders; the footer
          ticker renders beneath it (or not at all, when disabled - see
          FooterTicker.tsx's own comment). Both share ONE absolutely-
          positioned, bottom-anchored, auto-height wrapper instead of
          being independently placed - normal document flow inside it
          then guarantees "Powered by" always ends up directly above
          wherever the ticker (if any) currently renders, at ANY
          configured ticker height. A z-index-only fix (an earlier
          version of this file tried exactly that) technically paints
          "Powered by" on top of the ticker, but doesn't stop the
          ticker's own much bigger/bolder/brighter scrolling text from
          visually dominating the same screen region - confirmed by
          direct screenshot, not just reasoned about, which is why this
          is a real layout fix instead. ref={stackRef}: this being
          position:absolute means the panels grid above has no natural
          awareness of its height - useElementHeight measures it
          directly and the grid's own paddingBottom (above) reserves
          exactly that much, so panels/compass never render underneath
          it regardless of the tenant's configured ticker Height. */}
      <div ref={stackRef} className="absolute inset-x-0 bottom-0 z-10">
        {/* paddingBottom: TEMPLATE_EDGE_PADDING - keeps this credit
            line's own breathing room from the true bottom edge exactly
            what it always was (the outer div's own padding) for the
            common case where the ticker is off entirely (FooterTicker
            renders null, contributing zero height below). Deliberately
            on THIS div only, not the shared wrapper above - putting it
            there would also inset the ticker itself, undoing its own
            flush-to-the-true-edge behaviour from two rounds ago. When
            the ticker IS on, this same padding still applies on top of
            the ticker's own height, so "Powered by" keeps that same
            minimum clearance from the ticker bar too, not just the
            screen edge. */}
        <div className="flex items-center justify-center pt-1" style={{ paddingBottom: TEMPLATE_EDGE_PADDING }}>
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
        <FooterTicker />
      </div>
    </div>
  )
}
