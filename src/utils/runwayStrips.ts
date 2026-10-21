import type { RunwayGroup, RunwayStrip } from '../types/clubProfile'

// Number of parallel strips on one runway (1, 2 or 3). Storage is unchanged
// from the original twin/non-twin design: `twin` (D1 runway_groups.twin, 0/1)
// plus the `strips` JSON array. A third strip needs no schema change -
// stripsJson is already an open-ended array.
//
// How the count is read (must stay identical for every row saved before
// three strips existed): 3 strips in the array means 3; otherwise the
// existing `twin` flag decides 1 vs 2, exactly as the renderers always did
// (they never looked at strips.length for 1/2). Shobdon, Tiger and every
// other tenant therefore resolve to the same count - and draw the same
// pixels - as before.
export const MAX_RUNWAY_STRIPS = 3

export type RunwayStripCount = 1 | 2 | 3

export function runwayStripCount(group: Pick<RunwayGroup, 'twin' | 'strips'>): RunwayStripCount {
  if (group.strips.length >= MAX_RUNWAY_STRIPS) return 3
  return group.twin ? 2 : 1
}

// Starting values for a strip the admin has just added. For 1 and 2 strips
// these are exactly the defaults the Runways page used before (single
// strip grey; twin = green then grey); the third is green, like the first.
export function defaultStripFor(index: number, count: RunwayStripCount): RunwayStrip {
  const colour = index === 0 ? (count === 1 ? '#a8b4c4' : '#4caf50') : index === 1 ? '#a8b4c4' : '#4caf50'
  return { colour, widthPx: 22, hasThresholdMarkings: false, showIdentifierLabel: true, showCenterline: true }
}

// The twin flag and strips array to store for a chosen strip count. Keeps
// whichever strips already exist (dropping the last ones when reducing, so
// going 3 -> 2 -> 1 keeps the first strips), and fills any new slot with a
// default. `twin` stays true for 2 and 3 so older cached copies of the
// dashboard (which only know twin/non-twin) still show the first two strips.
export function withStripCount(
  group: Pick<RunwayGroup, 'strips'>,
  count: RunwayStripCount,
  defaultWidthPx = 22
): { twin: boolean; strips: RunwayStrip[] } {
  const strips = Array.from({ length: count }, (_, index) => {
    const existing = group.strips[index]
    return existing ?? { ...defaultStripFor(index, count), widthPx: defaultWidthPx }
  })
  return { twin: count >= 2, strips }
}
