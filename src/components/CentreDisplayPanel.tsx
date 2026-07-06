import CompassPanel from './CompassPanel'
import MediaPanel from './media/MediaPanel'
import { currentMedia } from '../config/media'

export default function CentreDisplayPanel(): JSX.Element {
  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Media Panel - fills the space left by the compass, fixed 16:9 viewport */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <MediaPanel item={currentMedia} />
      </div>

      {/* Compass Panel - the dominant instrument, sized to its content */}
      <div className="flex-shrink-0 overflow-hidden rounded-xl">
        <CompassPanel />
      </div>
    </div>
  )
}
