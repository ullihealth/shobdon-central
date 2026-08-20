import { useWeather } from '../../context/WeatherContext'

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
// "no icon library" glyph convention. onClick is a deliberate no-op
// placeholder for now, same posture as PilotHeader's own logo/future-
// login button - the real camera-view takeover isn't wired up yet
// (pending the primary-camera schema + live-embed work), but the
// tappable target/position is real so that wiring has one obvious
// place to attach without a layout change later.
export default function PilotWindCard(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const hasWind = !!weather && !liveDataUnavailable

  return (
    <section className="flex w-full items-baseline justify-center gap-3 rounded-2xl border border-border bg-panel p-4">
      <span className="text-2xl font-bold uppercase tracking-wide text-muted-400">Wind</span>
      <span className="text-5xl font-black text-primary">{hasWind && weather ? `${weather.windDirection}° / ${weather.windSpeed} kt` : 'N/A'}</span>
      <button
        type="button"
        onClick={() => {
          // Camera view takeover - not wired up yet, see this file's
          // own top comment.
        }}
        aria-label="Airfield camera"
        className="flex shrink-0 items-center justify-center self-center rounded-full p-2 text-muted-400 transition hover:bg-slate-800/60 hover:text-primary"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.4a1 1 0 0 0 .8-.4l.9-1.2a1 1 0 0 1 .8-.4h3.2a1 1 0 0 1 .8.4l.9 1.2a1 1 0 0 0 .8.4h2.4A1.5 1.5 0 0 1 20 8.5v8A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-8Z" />
          <circle cx="12" cy="12.5" r="3.25" />
        </svg>
      </button>
    </section>
  )
}
