import { useMemo } from 'react'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'

export interface CafeLoopTimesResult {
  // Total duration of every slot that currently has real content
  // assigned, regardless of whether it's enabled yet - a forward-
  // looking "if everything configured were switched on right now"
  // figure, useful for planning before flipping something live.
  preLoadedSeconds: number
  // Total duration of only the slots that are actually enabled right
  // now - matches exactly what publicConfig.ts's cafeCarouselSlots
  // query returns to the real public café screen at this moment (that
  // query's own WHERE clause is `enabled = 1`, nothing else), so this
  // number is verifiably identical to what a visitor watching the real
  // screen would experience.
  liveSeconds: number
}

// Café Total Loop Time fix round - functions/api/tenant/cafe-carousel/
// index.ts's own GET returns every slot's real mediaLibraryId/
// durationSeconds regardless of isReserved (masking only blocks
// editing, not the data itself - see that file's rowToApi), so a
// reserved slot with owner-assigned content is indistinguishable from
// an ordinary one for calculation purposes. Neither figure below needs
// any isReserved special-casing at all - every slot is judged purely by
// whether it's enabled (liveSeconds) or has real content assigned
// (preLoadedSeconds), applied uniformly to all 12 slots.
//
// This deliberately does NOT reuse useTotalLoopTime.ts (the dashboard's
// own bar, still used unmodified by MediaManagerPage.tsx/carousel_slots)
// - that hook always counts a reserved slot's flat 10s regardless of
// `enabled`, correct THERE because publicConfig.ts's dashboard carousel
// resolution force-injects a reserved slot into the live rotation
// unconditionally. Café has no such injection (confirmed via
// investigation - cafeCarouselSlots is driven purely by `enabled = 1`,
// reserved or not), so reusing that same always-10s logic here was the
// root cause of a real reported bug: a café tenant with reserved-but-
// disabled slots (the normal state until a developer both assigns
// content AND explicitly enables one) saw a "Total Loop Time" inflated
// by 10s per invisible phantom slot no viewer could ever see.
function hasAssignedContent(slot: CarouselSlot): boolean {
  switch (slot.mediaType) {
    case 'image':
    case 'mp4':
    case 'pdf':
      return !!slot.mediaLibraryId
    case 'webcam':
      return !!slot.cameraSlotNumber || !!slot.cameraId
    case 'website':
      return !!slot.externalUrl
    case 'gyropedia':
      // Built-in widget, nothing to assign - always "ready" the moment
      // this type is selected, same posture as every other type's own
      // "not configured yet" field just doesn't apply to it.
      return true
    default:
      return false
  }
}

// Mirrors MediaPanel.tsx's own rotation-timer formula exactly (its
// scheduleNext: an mp4 with a known real duration uses that; every
// other slot - including an mp4 whose duration hasn't resolved yet -
// uses its own durationSeconds column) rather than the stricter
// "exclude an unknown mp4 duration" stance useTotalLoopTime.ts takes
// for the dashboard's advisory budget figure. liveSeconds's whole point
// is to be verifiably identical to what a viewer's own rotation timer
// actually counts, so it has to use the exact same fallback that timer
// uses, not a more conservative one - the real screen never "skips"
// time for an unresolved duration either.
function effectiveSeconds(slot: CarouselSlot, files: MediaLibraryFile[]): number {
  if (slot.mediaType === 'mp4' && slot.mediaLibraryId) {
    const file = files.find((f) => f.id === slot.mediaLibraryId)
    if (file?.mp4DurationSeconds) return file.mp4DurationSeconds
  }
  return slot.durationSeconds
}

export function useCafeLoopTimes(slots: CarouselSlot[], files: MediaLibraryFile[]): CafeLoopTimesResult {
  return useMemo(() => {
    let preLoadedSeconds = 0
    let liveSeconds = 0
    for (const slot of slots) {
      const seconds = effectiveSeconds(slot, files)
      if (hasAssignedContent(slot)) preLoadedSeconds += seconds
      if (slot.enabled) liveSeconds += seconds
    }
    return { preLoadedSeconds, liveSeconds }
  }, [slots, files])
}

// Threshold round - 180s (3 minutes) or under reads as green (a loop
// short enough that a viewer sees everything without a long wait
// between repeats), over reads as red. Applied independently to each
// figure by the caller (CafeMediaPage.tsx), not baked into a single
// combined verdict, since Pre-Loaded and Live can legitimately differ.
const LOOP_LENGTH_WARNING_THRESHOLD_SECONDS = 180

export function loopLengthColorClass(totalSeconds: number): string {
  return totalSeconds <= LOOP_LENGTH_WARNING_THRESHOLD_SECONDS ? 'text-status-good' : 'text-status-bad'
}

// "300 seconds (5 mins)" / "46 seconds (46 secs)" / "125 seconds (2 mins
// 5 secs)" - the bracketed conversion always uses "mins"/"secs"
// (distinct from formatLoopDuration's own "4m 32s" shorthand above,
// which this deliberately doesn't reuse - that format reads fine as a
// compact dashboard-bar figure, but Jeff specifically asked for this
// page's two enlarged figures to spell out "X seconds (Y mins)").
export function formatLoopSecondsWithMinutes(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const bracket =
    minutes === 0 ? plural(seconds, 'sec') : seconds === 0 ? plural(minutes, 'min') : `${plural(minutes, 'min')} ${plural(seconds, 'sec')}`
  return `${plural(s, 'second')} (${bracket})`
}
