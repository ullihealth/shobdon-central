import CompassPanel from './CompassPanel'
import MediaPanel from './media/MediaPanel'
import { currentMedia } from '../config/media'

export default function CentreDisplayPanel(): JSX.Element {
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Media Panel and Compass Panel share this column's height by a fixed
          ratio (3:2) rather than one being viewport-locked and the other
          just absorbing whatever's left - both flex items are min-h-0 so
          each can actually shrink, and the ratio holds by construction at
          any resolution/aspect ratio instead of one side being able to
          dominate and squeeze the other. */}
      <div className="flex-[3] min-h-0 flex items-center justify-center overflow-hidden">
        <MediaPanel item={currentMedia} />
      </div>

      <div className="flex-[2] min-h-0 overflow-hidden rounded-xl">
        <CompassPanel />
      </div>
    </div>
  )
}
