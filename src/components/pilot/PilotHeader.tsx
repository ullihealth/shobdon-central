import LiveClock from './LiveClock'
import AfisoIndicator from './AfisoIndicator'
import WeatherStatusIndicator from '../WeatherStatusIndicator'

interface PilotHeaderProps {
  airfieldName: string | null
  logoUrl: string | null
  afisoOpen: boolean
  afisoFrequency: string
}

// Pilot View header (Section 1). Logo doubles as the future login entry
// point - no auth logic yet (per spec), just a tappable target so login
// can be wired behind it later without a header redesign. onClick is a
// deliberate no-op placeholder, not left unhandled/absent, so the
// eventual login wiring has one obvious place to attach rather than
// needing a header restructure to add a click target that doesn't exist
// yet.
export default function PilotHeader({ airfieldName, logoUrl, afisoOpen, afisoFrequency }: PilotHeaderProps): JSX.Element {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-panel/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={() => {
          // Future login entry point - intentionally a no-op today, per
          // spec ("no auth logic yet, just build the logo as a tappable
          // target").
        }}
        className="flex items-center gap-2"
        aria-label={airfieldName ? `${airfieldName} - tap to log in` : 'Tap to log in'}
      >
        {logoUrl ? (
          <img src={logoUrl} alt={airfieldName ?? 'Airfield logo'} className="h-9 max-w-[120px] object-contain" />
        ) : (
          <span className="text-sm font-bold uppercase tracking-wide text-primary">{airfieldName ?? 'Airfield Central'}</span>
        )}
      </button>
      {/* Centered independently of the logo/right-column widths, same
          "absolute + left-1/2 + -translate-x-1/2" horizontal-centering
          trick Header.tsx's own clock already uses on the TV dashboard -
          the sticky header this sits in already establishes a
          positioning context (position:sticky counts as "positioned"
          for this purpose, same as relative/absolute), so no extra
          wrapper is needed for that. top-1/2 + -translate-y-1/2 ALSO
          centers it vertically - needed here in a way Header.tsx's own
          version never had to handle, since removing this element from
          the flex flow (absolute positioning) means it no longer
          affects the header's own height, and without an explicit
          vertical anchor it would default to sitting at its old
          in-flow position instead of truly centered, overlapping
          whatever the header's height ends up being. */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <LiveClock />
      </div>
      <div className="flex flex-col items-end gap-1">
        {/* Reused unmodified from the TV dashboard - same component,
            same live/fallback/no-reading state machine, not a
            hardcoded "LIVE ATC" label. A hardcoded label would show a
            false "live" status the moment the real feed degrades to
            the Met Office fallback or drops out entirely - exactly the
            kind of misleading state this app avoids everywhere else. */}
        <WeatherStatusIndicator />
        <AfisoIndicator open={afisoOpen} frequency={afisoFrequency} />
      </div>
    </header>
  )
}
