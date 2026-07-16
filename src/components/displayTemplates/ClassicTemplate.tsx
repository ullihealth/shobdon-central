import type { CSSProperties } from 'react'
import CompassPanel from '../CompassPanel'
import Header from '../Header'
import LeftInfoPanel from '../LeftInfoPanel'
import MediaPanel from '../media/MediaPanel'
import RightInfoPanel from '../RightInfoPanel'
import WeatherStatusIndicator from '../WeatherStatusIndicator'
import { currentMedia } from '../../config/media'
import type { DisplayPanelConfig } from './panelConfig'
import { useIsDesktopLayout } from '../../hooks/useIsDesktopLayout'

interface ClassicTemplateProps {
  panelConfig: DisplayPanelConfig
  themeOverride: CSSProperties
}

// The 'classic' template (tenant_displays.template_id) - the same
// three-column layout as src/pages/DashboardPage.tsx (still the
// component that renders '/' unchanged), reused here as one selectable
// template among several rather than the page's only layout. Kept as a
// deliberate near-duplicate of that page's JSX/grid rather than a shared
// extraction, so '/' - the live production kiosk route - carries zero
// risk from this feature: DashboardPage.tsx is not imported by or
// changed for this file at all.
export default function ClassicTemplate({ panelConfig, themeOverride }: ClassicTemplateProps): JSX.Element {
  const isDesktop = useIsDesktopLayout()

  const showLeft = panelConfig.weather
  const showCenter = panelConfig.media || panelConfig.compass
  const showRight = panelConfig.ops

  const columns: string[] = []
  if (showLeft) columns.push('23fr')
  if (showCenter) columns.push('54fr')
  if (showRight) columns.push('23fr')

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
            ? { display: 'grid', gridTemplateRows: '7% minmax(0, 1fr) auto', gap: '16px' }
            : { display: 'flex', flexDirection: 'column', gap: '16px' }
        }
      >
        {/* Fixed height on mobile (not auto/flex-shrink) - Header's own
            content assumes a real box to center the clock/status slot
            within; stacked flex-column layout otherwise gives it only as
            much height as its content strictly needs, which clipped the
            clock in testing. */}
        <div style={isDesktop ? undefined : { height: '64px', flexShrink: 0 }}>
          <Header rightSlot={<WeatherStatusIndicator />} />
        </div>

        <div
          style={
            isDesktop
              ? {
                  display: 'grid',
                  gridTemplateColumns: columns.join(' ') || '1fr',
                  gridTemplateRows: 'minmax(0, 1fr)',
                  gap: '16px',
                  height: '100%',
                }
              : { display: 'flex', flexDirection: 'column', gap: '16px' }
          }
        >
          {showLeft && (
            <div className={isDesktop ? 'h-full' : ''}>
              <LeftInfoPanel />
            </div>
          )}

          {showCenter && (
            <div
              className="overflow-hidden"
              style={
                isDesktop
                  ? { height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }
                  : { display: 'flex', flexDirection: 'column', gap: '16px' }
              }
            >
              {panelConfig.media && (
                <div
                  className="flex items-center justify-center overflow-hidden"
                  style={isDesktop ? { flex: 3, minHeight: 0 } : undefined}
                >
                  <MediaPanel item={currentMedia} />
                </div>
              )}
              {panelConfig.compass && (
                <div className="rounded-xl" style={isDesktop ? { flex: 2, minHeight: 0, overflow: 'hidden' } : undefined}>
                  <CompassPanel />
                </div>
              )}
            </div>
          )}

          {showRight && (
            <div className={isDesktop ? 'h-full' : ''}>
              <RightInfoPanel />
            </div>
          )}
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
