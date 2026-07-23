const MAX_SAVED_SWATCHES = 5

interface ColorFieldProps {
  label: string
  // Whatever shape the caller's own colour state uses (DesignPage.tsx's
  // activeTokens values are hex or rgba() strings) - this component
  // never parses/interprets it, just round-trips it to the native
  // input and to onChange, exactly like a bare <input type="color">
  // wrapped in a <label> would. toHex only affects what gets SAVED into
  // a swatch slot (always a plain #rrggbb, matching the server's own
  // validation) - see onCaptureSwatch below.
  value: string
  onChange: (value: string) => void
  // Converts this field's current `value` to the plain #rrggbb a swatch
  // slot stores - the caller already has this logic (DesignPage.tsx's
  // rgbaToHex), so it's passed in rather than duplicated here.
  toHex: (value: string) => string
  // Up to 5 saved hex strings, shared/global across every ColorField
  // instance on the page (not per-field local state) - the caller owns
  // this array (and the PUT that persists it) so multiple instances
  // never drift out of sync with each other.
  savedSwatches: string[]
  // Fired when an EMPTY slot is clicked - the caller already knows this
  // field's current value (the same `value` prop above), so this takes
  // no argument; the caller just appends toHex(value) itself.
  onCaptureSwatch: () => void
  onClearSwatch: (hex: string) => void
}

// Native <input type="color"> plus a row of up to 5 reusable "brand
// colour" swatch slots beside it - NOT inside the native picker's own
// panel, which is browser/OS chrome that can't be modified or injected
// into (confirmed: that floating gradient-square/hue-slider/RGB-fields
// panel is Chrome's own built-in colour picker UI, not anything this
// app renders). A filled slot applies its colour on click; an empty
// slot (dashed outline) captures this field's current colour into that
// slot; a small × appears on hover over a filled slot to clear it.
// Extracted from what was previously identical, separately-typed-out
// <label>+<input type="color"> markup duplicated in exactly two places
// in DesignPage.tsx (the Text/Accent & Status shared renderer, and the
// Backgrounds/Custom sub-view) - both now use this one component.
// Deliberately generic (no DesignPage-specific imports) so reusing it
// in SlideEditor.tsx/CafeMediaPage.tsx/RunwaysPage.tsx's own colour
// pickers later is just dropping this component in, not a rebuild -
// not wired into any of those this round, per explicit scope.
export default function ColorField({ label, value, onChange, toHex, savedSwatches, onCaptureSwatch, onClearSwatch }: ColorFieldProps): JSX.Element {
  const slots: (string | null)[] = Array.from({ length: MAX_SAVED_SWATCHES }, (_, i) => savedSwatches[i] ?? null)

  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-1 py-1.5 hover:border-border">
      <span className="text-xs capitalize text-muted-400">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {slots.map((hex, index) =>
            hex ? (
              <div key={index} className="group/swatch relative h-5 w-5 shrink-0">
                <button
                  type="button"
                  onClick={() => onChange(hex)}
                  title={hex}
                  style={{ backgroundColor: hex }}
                  className="h-5 w-5 rounded border border-border"
                  aria-label={`Apply saved colour ${hex}`}
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onClearSwatch(hex)
                  }}
                  aria-label={`Clear saved colour ${hex}`}
                  className="absolute -right-1 -top-1 hidden h-3 w-3 items-center justify-center rounded-full bg-slate-950 text-[8px] leading-none text-muted-400 group-hover/swatch:flex hover:text-status-bad"
                >
                  ×
                </button>
              </div>
            ) : (
              <button
                key={index}
                type="button"
                onClick={onCaptureSwatch}
                title="Save this field's current colour here"
                aria-label="Save current colour to an empty slot"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-border text-[10px] leading-none text-muted-500 transition hover:border-accent-sky-500 hover:text-accent-sky-400"
              >
                +
              </button>
            )
          )}
        </div>
        <input
          type="color"
          value={toHex(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
      </div>
    </label>
  )
}
