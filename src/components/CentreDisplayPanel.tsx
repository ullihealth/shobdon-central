import CompassPanel from './CompassPanel'
import MediaPanel, { type MediaPanelSourceData } from './media/MediaPanel'
import { currentMedia } from '../config/media'
import { useIsDesktopLayout } from '../hooks/useIsDesktopLayout'

interface CentreDisplayPanelProps {
  // Passed straight through to MediaPanel's own `data` prop - see that
  // component's comment for why this exists (an authenticated admin
  // preview's session-switched org can differ from the browser's
  // current subdomain, which is what MediaPanel's own self-fetch
  // resolves by). Every existing caller (the real public dashboard, via
  // Clubhouse1Template) omits this and is unaffected.
  mediaData?: MediaPanelSourceData
}

export default function CentreDisplayPanel({ mediaData }: CentreDisplayPanelProps = {}): JSX.Element {
  const isDesktop = useIsDesktopLayout()

  return (
    <div
      className="flex flex-col gap-4 overflow-hidden"
      style={isDesktop ? { height: '100%' } : undefined}
    >
      {/* Media Panel and Compass Panel share this column's height by a fixed
          ratio (3:2) rather than one being viewport-locked and the other
          just absorbing whatever's left - both flex items are min-h-0 so
          each can actually shrink, and the ratio holds by construction at
          any resolution/aspect ratio instead of one side being able to
          dominate and squeeze the other. Desktop only: below md, both
          panels stack with natural height instead (the page scrolls) -
          forcing a fixed h-full split at phone width squeezed CompassPanel's
          readout row (designed to sit beside the compass, not above/below
          it in a short box) into overflowing its own container. */}
      <div
        className="flex items-center justify-center overflow-hidden"
        style={isDesktop ? { flex: 3, minHeight: 0 } : undefined}
      >
        <MediaPanel item={currentMedia} data={mediaData} />
      </div>

      <div className="rounded-xl" style={isDesktop ? { flex: 2, minHeight: 0, overflow: 'hidden' } : undefined}>
        <CompassPanel />
      </div>
    </div>
  )
}
