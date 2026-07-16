import type { CSSProperties } from 'react'
import CompassPanel from '../CompassPanel'
import Header from '../Header'
import LeftInfoPanel from '../LeftInfoPanel'
import MediaPanel from '../media/MediaPanel'
import RightInfoPanel from '../RightInfoPanel'
import WeatherStatusIndicator from '../WeatherStatusIndicator'
import { currentMedia } from '../../config/media'
import type { DisplayPanelConfig } from './panelConfig'

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
  const showLeft = panelConfig.weather
  const showCenter = panelConfig.media || panelConfig.compass
  const showRight = panelConfig.ops

  const columns: string[] = []
  if (showLeft) columns.push('23fr')
  if (showCenter) columns.push('54fr')
  if (showRight) columns.push('23fr')

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100"
      style={{ ...themeOverride, padding: 'clamp(12px, 3vmin, 48px)' }}
    >
      <div className="h-full" style={{ display: 'grid', gridTemplateRows: '7% minmax(0, 1fr) auto', gap: '16px' }}>
        <Header rightSlot={<WeatherStatusIndicator />} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns.join(' ') || '1fr',
            gridTemplateRows: 'minmax(0, 1fr)',
            gap: '16px',
            height: '100%',
          }}
        >
          {showLeft && (
            <div className="h-full">
              <LeftInfoPanel />
            </div>
          )}

          {showCenter && (
            <div className="h-full flex flex-col gap-4 overflow-hidden">
              {panelConfig.media && (
                <div className="flex-[3] min-h-0 flex items-center justify-center overflow-hidden">
                  <MediaPanel item={currentMedia} />
                </div>
              )}
              {panelConfig.compass && (
                <div className="flex-[2] min-h-0 overflow-hidden rounded-xl">
                  <CompassPanel />
                </div>
              )}
            </div>
          )}

          {showRight && (
            <div className="h-full">
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
