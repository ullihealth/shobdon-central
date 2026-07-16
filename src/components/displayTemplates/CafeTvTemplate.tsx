import type { CSSProperties } from 'react'
import Header from '../Header'
import LeftInfoPanel from '../LeftInfoPanel'
import MediaPanel from '../media/MediaPanel'
import RightInfoPanel from '../RightInfoPanel'
import WeatherStatusIndicator from '../WeatherStatusIndicator'
import { currentMedia } from '../../config/media'
import type { DisplayPanelConfig } from './panelConfig'

interface CafeTvTemplateProps {
  panelConfig: DisplayPanelConfig
  themeOverride: CSSProperties
}

// The 'cafe-tv' template - simpler than 'classic', suited to a TV viewed
// from across a room (a clubhouse cafe) rather than a desk-distance
// kiosk. No compass slot at all (unlike ClassicTemplate) - the
// wind/runway compass is a working instrument for pilots and ATC at
// close range, not something a cafe patron gets value from at a
// distance; panelConfig still controls weather/media/ops for this
// template, `compass` simply isn't one of this layout's regions.
//
// Full body-height columns, same as ClassicTemplate - deliberately NOT
// a stacked "big media on top, everything else in a short strip below"
// arrangement. LeftInfoPanel/RightInfoPanel size their text off the
// browser's *viewport* height internally (vh-based clamp(), not their
// own container's height - see LeftInfoPanel.tsx's own comments), so
// squeezing either into a short row overflows regardless of width; a
// stacked layout was tried and produced exactly that. Full-height
// columns are the arrangement both components are already proven to
// render correctly at (Classic uses it too) - the real differentiator
// here is that the media panel gets the WHOLE centre column height
// (no compass sharing it 3:2) and the side columns are wider, not a
// vertical stack.
export default function CafeTvTemplate({ panelConfig, themeOverride }: CafeTvTemplateProps): JSX.Element {
  const showLeft = panelConfig.weather
  const showCenter = panelConfig.media
  const showRight = panelConfig.ops

  const columns: string[] = []
  if (showLeft) columns.push('27fr')
  if (showCenter) columns.push('56fr')
  if (showRight) columns.push('27fr')

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
            <div className="h-full flex items-center justify-center overflow-hidden">
              <MediaPanel item={currentMedia} />
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
