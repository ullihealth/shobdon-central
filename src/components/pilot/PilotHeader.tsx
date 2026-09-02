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
        // absolute + top-[12px] + left-4 ONLY when there's a real logo image -
        // takes this button fully out of the header's own flex flow, the
        // same reason the clock below is absolutely positioned (see that
        // div's own comment): a taller in-flow logo would grow the
        // header's own auto-height to fit it (confirmed the hard way -
        // an earlier self-start+margin attempt did exactly that, growing
        // the header from 52px to 68.5px and silently pulling the clock/
        // AFISO alignment fix a round ago out of sync, since that fix's
        // own top-[calc(50%+10px)] offset was calibrated against the
        // OLD 52px header height). top-[12px]/left-4 reproduce this
        // button's own previous in-flow position - top is an explicit
        // pixel value, not top-3 (0.75rem), because this page's root
        // font-size is smaller than the usual 16px default, so top-3
        // actually computed to 9px here, not 12px (confirmed by direct
        // measurement, not assumption - an arbitrary pixel value sidesteps
        // that rem-scale trap entirely). left-4 happens to already land on
        // exactly 12px at this same root scale, confirmed the same way.
        // Scoped to the logoUrl branch only -
        // the plain-text fallback (no logo configured) stays in normal
        // flow, centred exactly as it always has, completely unaffected.
        className={logoUrl ? 'absolute left-4 top-[12px]' : 'flex items-center gap-2'}
        aria-label={airfieldName ? `${airfieldName} - tap to log in` : 'Tap to log in'}
      >
        {logoUrl ? (
          // h-9 (27px rendered) -> h-[37.5px] - grows the logo so its
          // OWN bottom edge lands level with the clock's bottom edge
          // (measured live: logo top 12px/bottom 39px before, clock
          // wrapper bottom 49.5px - new height 49.5-12=37.5px lands the
          // new bottom exactly on the clock's own). object-contain
          // already preserves aspect ratio on height change alone -
          // width grows proportionally with no separate width value
          // needed, and stays well under the existing max-w-[120px]
          // cap (real logo's own aspect ratio puts the new width around
          // ~82px, not 120px). Now safe to grow freely regardless of
          // height, since the button wrapping it is out of flow above.
          <img src={logoUrl} alt={airfieldName ?? 'Airfield logo'} className="h-[37.5px] max-w-[120px] object-contain" />
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
          wrapper is needed for that.

          Vertical anchor is deliberately NOT the header's true
          geometric centre (a plain top-1/2 would put it there) - the
          right column is two stacked rows of very different height
          (WeatherStatusIndicator's single badge line, then
          AfisoIndicator's smaller line below it), so centering on the
          header's own midpoint visually reads as level with the FIRST
          row, not evenly between the two. Measured directly (real
          rendered rects, iPhone 13 viewport): header centre sits at
          26px, row 1 (WeatherStatusIndicator) centre at 18px, row 2
          (AfisoIndicator) centre at 36px - a 10px anchor offset lands
          the clock's own centre on row 2 instead. -translate-y-1/2
          still does the actual centering (on this NEW, offset anchor
          point) - unchanged from before, only the anchor moved. Moving
          this div moves the clock's suffix (BST/GMT/Z, depending on
          pilotClockMode) down with the time digits automatically - it's
          one wrapped <span> per LiveClock.tsx, not a separate element
          needing its own adjustment. */}
      <div className="absolute left-1/2 top-[calc(50%+10px)] -translate-x-1/2 -translate-y-1/2">
        <LiveClock />
      </div>
      {/* ml-auto (not just the header's own justify-between) - the logo
          button is absolutely positioned when a real logo is set (see
          its own comment above), so this column is often the ONLY
          remaining flow child of the header; justify-between has
          nothing left to distribute space between in that case and a
          lone flex item under it sits at flex-start (left), not the
          right edge. ml-auto forces this column to the far right
          regardless of how many other flow siblings exist - harmless
          and redundant (not a behaviour change) in the plain-text-
          fallback case, where the logo button IS still a normal flow
          sibling and justify-between alone was already sufficient. */}
      <div className="ml-auto flex flex-col items-end gap-1">
        {/* Reused from the TV dashboard - same component, same live/
            fallback/no-reading state machine, not a hardcoded "LIVE ATC"
            label. A hardcoded label would show a false "live" status the
            moment the real feed degrades to the Met Office fallback or
            drops out entirely - exactly the kind of misleading state
            this app avoids everywhere else. hideIcon drops the leading
            emoji/dot for this header specifically - text label only,
            desktop dashboard unaffected (defaults false there). */}
        <WeatherStatusIndicator hideIcon />
        <AfisoIndicator open={afisoOpen} frequency={afisoFrequency} />
      </div>
    </header>
  )
}
