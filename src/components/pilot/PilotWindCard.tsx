import { useEffect, useRef, useState } from 'react'
import { useWeather } from '../../context/WeatherContext'

const TOAST_DURATION_MS = 4000

interface PilotWindCardProps {
  // Resolved primary-camera embed URL (functions/api/_utils/
  // publicConfig.ts's own primaryCameraUrl, threaded down from
  // PilotViewPage) - null covers both "no primary camera configured"
  // and "configured but mode='local'-only, unusable off-site" per
  // spec; this component can't and doesn't need to tell those two
  // apart, since the resulting tap behaviour is identical either way.
  primaryCameraUrl: string | null
  onOpenCamera: () => void
}

// Reorder round: the "WIND 260° / 9 kt" readout used to live inline
// inside PilotRunwayWindPanel, directly above the crosswind/headwind
// widget group. Pulled out into its own full-width card here so it can
// sit at the very top of the page (above Weather Summary) - same
// rounded-2xl/border/bg-panel card treatment as WeatherStatGrid's own
// <section>, per the request. Self-contained (own useWeather() call),
// same "drop in anywhere" pattern as every other Pilot View panel.
//
// Camera view round: a camera-icon button sits right after the wind
// value, inside the same centered flex row - adding it as a third
// child of a `justify-center` row is what naturally shifts "Wind
// 260°/9 kt" slightly left to make room, with no separate margin/
// offset hack needed (confirmed by inspection: centering 3 items
// versus 2 in the same row does this automatically). Placed here
// (top of the page, one-handed reach, no scrolling) per spec. Plain
// inline SVG, not an icon library - matches PilotHeader.tsx's own
// "no icon library" glyph convention.
//
// Tap behaviour forks on primaryCameraUrl: non-null bubbles up via
// onOpenCamera (PilotViewPage owns the full-viewport takeover's own
// open/closed state, since PilotCameraView needs to render above
// everything, not just within this card); null shows a local,
// self-dismissing toast instead of hiding the button - the button
// stays a permanent, always-tappable feature-discovery point for a
// tenant who hasn't configured a camera yet, per spec, not just an
// error state for one who has.
export default function PilotWindCard({ primaryCameraUrl, onOpenCamera }: PilotWindCardProps): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const hasWind = !!weather && !liveDataUnavailable

  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  function handleTapCamera() {
    if (primaryCameraUrl) {
      onOpenCamera()
      return
    }
    setToast('Please connect an airfield camera to enable this feature')
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
  }

  return (
    <section className="relative flex w-full items-baseline justify-center gap-3 rounded-2xl border border-border bg-panel p-4">
      <span className="text-2xl font-bold uppercase tracking-wide text-muted-400">Wind</span>
      <span className="text-5xl font-black text-primary">{hasWind && weather ? `${weather.windDirection}° / ${weather.windSpeed} kt` : 'N/A'}</span>
      <button
        type="button"
        onClick={handleTapCamera}
        aria-label="Airfield camera"
        className="flex shrink-0 items-center justify-center self-center rounded-full p-2 text-muted-400 transition hover:bg-slate-800/60 hover:text-primary"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.4a1 1 0 0 0 .8-.4l.9-1.2a1 1 0 0 1 .8-.4h3.2a1 1 0 0 1 .8.4l.9 1.2a1 1 0 0 0 .8.4h2.4A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-8Z" />
          <circle cx="12" cy="12.5" r="3.25" />
        </svg>
      </button>
      {/* Self-dismissing, non-blocking - same SelectionToast pattern
          SlideEditor.tsx already established (absolute overlay, no
          toast/popover library), positioned below this card rather
          than that component's own top-right (this card sits at the
          very top of the page, so above would risk clipping under the
          sticky header). */}
      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-max max-w-[90%] -translate-x-1/2 rounded-lg border border-accent-sky-500/50 bg-slate-950/95 px-4 py-2.5 text-center text-sm text-slate-200 shadow-xl"
        >
          {toast}
        </div>
      )}
    </section>
  )
}
