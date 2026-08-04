import LiveClock from './LiveClock'
import MetarStrip from './MetarStrip'
import AfisoIndicator from './AfisoIndicator'

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
      <div className="flex flex-col items-end gap-1">
        <LiveClock />
        <MetarStrip />
        <AfisoIndicator open={afisoOpen} frequency={afisoFrequency} />
      </div>
    </header>
  )
}
