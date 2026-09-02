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
    // flex-col, two rows - logo/status on row 1, clock on its own row 2
    // below. Previously the clock sat absolutely-positioned on TOP of
    // row 1, centred across the header's full width via left-1/2 - but
    // at this font size the clock renders ~157px wide while the gap
    // between the logo's right edge and the status column's left edge
    // is only ~144px, so centering it there always overlapped one side
    // or the other (measured live: -7.6px into the logo, -5.3px into
    // the status column - no horizontal shift could have cleared both
    // at once). Giving the clock its own row below removes the width
    // contention entirely - it now centres across the full 390px row
    // with nothing else sharing that space. Header height is no longer
    // a hand-picked number: it's flex-col content-driven, so it just
    // grows to fit both rows on its own - nothing to recalibrate here
    // if row 1's own height ever changes.
    <header className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-panel/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            // Future login entry point - intentionally a no-op today, per
            // spec ("no auth logic yet, just build the logo as a tappable
            // target").
          }}
          // absolute + top-[12px] + left-4 ONLY when there's a real logo
          // image - takes this button fully out of this row's own flex
          // flow, so a taller logo image can never grow row 1's height
          // (and with it the whole header) to fit itself. top is an
          // explicit pixel value, not top-3 (0.75rem), because this
          // page's root font-size is smaller than the usual 16px
          // default, so top-3 actually computed to 9px here, not 12px
          // (confirmed by direct measurement, not assumption - an
          // arbitrary pixel value sidesteps that rem-scale trap
          // entirely). left-4 happens to already land on exactly 12px
          // at this same root scale, confirmed the same way. Scoped to
          // the logoUrl branch only - the plain-text fallback (no logo
          // configured) stays in normal flow, centred exactly as it
          // always has, completely unaffected.
          className={logoUrl ? 'absolute left-4 top-[12px]' : 'flex items-center gap-2'}
          aria-label={airfieldName ? `${airfieldName} - tap to log in` : 'Tap to log in'}
        >
          {logoUrl ? (
            // h-9 (27px rendered) -> h-[37.5px] - grows the logo so its
            // OWN bottom edge lands level with the status column's
            // bottom edge (measured live: logo top 12px/bottom 39px
            // before, status column bottom 42px). object-contain
            // already preserves aspect ratio on height change alone -
            // width grows proportionally with no separate width value
            // needed, and stays well under the existing max-w-[120px]
            // cap (real logo's own aspect ratio puts the new width
            // around ~82px, not 120px). Now safe to grow freely
            // regardless of height, since the button wrapping it is out
            // of flow above.
            <img src={logoUrl} alt={airfieldName ?? 'Airfield logo'} className="h-[37.5px] max-w-[120px] object-contain" />
          ) : (
            <span className="text-sm font-bold uppercase tracking-wide text-primary">{airfieldName ?? 'Airfield Central'}</span>
          )}
        </button>
        {/* ml-auto (not just this row's own justify-between) - the logo
            button is absolutely positioned when a real logo is set (see
            its own comment above), so this column is often the ONLY
            remaining flow child of this row; justify-between has
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
      </div>
      {/* Row 2 - clock, on its own line below, centred across the full
          header width via a plain flex justify-center (no absolute
          positioning/percentage anchor needed any more - see the
          header's own comment above for why this replaced the old
          overlapping single-row layout). */}
      <div className="flex justify-center">
        <LiveClock />
      </div>
    </header>
  )
}
