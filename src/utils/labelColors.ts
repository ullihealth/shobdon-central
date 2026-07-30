// Small fixed palette for IP labels (ip_labels.color, migration 0058) -
// a full colour wheel would be overkill for "make labels visually
// distinguishable at a glance". Each entry maps to real Tailwind
// utility classes - a deliberate subset of Tailwind's own default
// colours (already used elsewhere in this app, e.g. the amber warning
// badges on Known Devices), not a custom design-token set, so no new
// CSS is needed anywhere this renders.
export interface LabelColorEntry {
  key: string
  name: string
  // Solid background, for the picker's own swatch buttons.
  swatchClass: string
  // Translucent bg + border + text, for the rendered pill everywhere
  // else (Visit Log's Label column, Hide filter pills, IP Directory,
  // Known Devices warnings).
  pillClass: string
}

export const LABEL_COLOR_PALETTE: LabelColorEntry[] = [
  { key: 'sky', name: 'Sky', swatchClass: 'bg-sky-500', pillClass: 'border-sky-500/40 bg-sky-500/10 text-sky-400' },
  {
    key: 'emerald',
    name: 'Emerald',
    swatchClass: 'bg-emerald-500',
    pillClass: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  },
  {
    key: 'amber',
    name: 'Amber',
    swatchClass: 'bg-amber-500',
    pillClass: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  },
  { key: 'rose', name: 'Rose', swatchClass: 'bg-rose-500', pillClass: 'border-rose-500/40 bg-rose-500/10 text-rose-400' },
  {
    key: 'violet',
    name: 'Violet',
    swatchClass: 'bg-violet-500',
    pillClass: 'border-violet-500/40 bg-violet-500/10 text-violet-400',
  },
  { key: 'cyan', name: 'Cyan', swatchClass: 'bg-cyan-500', pillClass: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' },
  {
    key: 'fuchsia',
    name: 'Fuchsia',
    swatchClass: 'bg-fuchsia-500',
    pillClass: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-400',
  },
  { key: 'lime', name: 'Lime', swatchClass: 'bg-lime-500', pillClass: 'border-lime-500/40 bg-lime-500/10 text-lime-400' },
]

// Not cryptographic - just needs to spread reasonably evenly across 8
// buckets so different group names usually land on different colours.
// djb2, a well-known simple string hash, is more than enough for that.
function hashToIndex(value: string, bucketCount: number): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return Math.abs(hash) % bucketCount
}

// The single source of truth every render location calls: an explicit
// stored colour wins if it's a real palette key, otherwise the same
// group name always deterministically resolves to the same colour -
// "looks sensible with zero setup" per the feature's own spec, not a
// random colour that'd shift between renders/reloads.
export function resolveLabelColor(color: string | null | undefined, groupName: string): LabelColorEntry {
  if (color) {
    const explicit = LABEL_COLOR_PALETTE.find((c) => c.key === color)
    if (explicit) return explicit
  }
  return LABEL_COLOR_PALETTE[hashToIndex(groupName, LABEL_COLOR_PALETTE.length)]
}
