import { useState } from 'react'
import { createPortal } from 'react-dom'

interface PilotCameraViewProps {
  url: string
  onClose: () => void
}

// Full-viewport camera takeover, reached by tapping PilotWindCard's
// camera icon. Portaled to document.body - same reasoning as
// MediaPanel.tsx's own auto-fullscreen camera overlay on the TV
// dashboard (this component can sit arbitrarily deep inside /pilot's
// own layout; position:fixed alone isn't reliable from inside an
// ancestor that happens to set its own transform, and portaling
// sidesteps that regardless of whether one's actually present here
// today). z-50 matches that same overlay's own z-index convention.
//
// Close/reload controls sit in a small pill near the TOP of the
// overlay, horizontally centered - matching where the camera icon
// itself sits in PilotWindCard's own centered row, so the tap target
// is roughly where the pilot's thumb already is. Essential, not
// decorative: /pilot can run as an installed PWA with no browser
// chrome, so there is no other way back once this is open.
//
// Dead/frozen-feed handling: a cross-origin iframe (YouTube embed,
// rtsp.me relay page, go2rtc stream page) gives the parent page no
// reliable signal that playback has silently frozen while the iframe
// itself still "loaded" fine - onError only ever fires for a genuine
// connection-level failure, not "connected once, then stopped
// updating frames" (confirmed against CameraPanel.tsx's own identical
// onError caveat). Shobdon's own relay is known to do exactly this
// after ~4 minutes. Rather than guess at a fixed timer, this exposes a
// permanent, always-visible manual Reload control next to Close -
// remounting the iframe via the `key` prop forces a genuinely fresh
// load, and the caption underneath sets the expectation up front so a
// frozen frame doesn't read as this feature being broken.
export default function PilotCameraView({ url, onClose }: PilotCameraViewProps): JSX.Element {
  const [reloadKey, setReloadKey] = useState(0)

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black">
      <iframe
        key={reloadKey}
        src={url}
        className="h-full w-full"
        style={{ border: 0 }}
        allow="autoplay; encrypted-media"
        allowFullScreen
        title="Airfield camera"
      />
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1.5">
        <div className="flex items-center gap-2 rounded-full bg-black/70 p-1.5 backdrop-blur">
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            aria-label="Reload camera feed"
            className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/15"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera view"
            className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/15"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-slate-300 backdrop-blur">
          Feed frozen? Tap reload
        </span>
      </div>
    </div>,
    document.body
  )
}
