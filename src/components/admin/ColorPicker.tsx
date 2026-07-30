import { LABEL_COLOR_PALETTE } from '../../utils/labelColors'

interface ColorPickerProps {
  value: string | null
  onChange: (color: string | null) => void
}

// A fixed swatch grid, not a colour wheel - "small fixed palette is
// fine" per the feature's own spec. Includes an explicit "Auto" option
// (value null) so a label can deliberately opt back into the
// deterministic hash-derived colour after having an override set.
export function ColorPicker({ value, onChange }: ColorPickerProps): JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        title="Auto (derived from group name)"
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-[9px] font-bold uppercase ${
          value === null ? 'border-white text-white' : 'border-slate-600 text-muted-500 hover:border-slate-400'
        }`}
      >
        A
      </button>
      {LABEL_COLOR_PALETTE.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => onChange(entry.key)}
          title={entry.name}
          className={`h-6 w-6 rounded-full border-2 ${entry.swatchClass} ${
            value === entry.key ? 'border-white' : 'border-transparent'
          }`}
        />
      ))}
    </div>
  )
}
