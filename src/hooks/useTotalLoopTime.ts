import { useMemo } from 'react'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'

// Matches publicConfig.ts's own fixed reserved-slot duration (Reserved
// Owner Slots & Time Budget round) - a reserved slot (isReserved) is
// ALWAYS in the live rotation for exactly 10s, regardless of its own
// `enabled`/durationSeconds column (which may not even be meaningful
// for it - see that file's own "a reserved slot must ALWAYS be in the
// rotation" comment). This is deliberately NOT the same number
// MediaManagerPage.tsx's own computeUsedSeconds/budget feature uses -
// that one excludes reserved slots entirely, because it's answering
// "how much of the tenant's OWN controllable budget is used", not
// "how long is the loop a viewer actually sees". Total loop time needs
// the latter, so reserved slots count here even though they don't
// count there.
const RESERVED_SLOT_SECONDS = 10

export interface TotalLoopTimeResult {
  totalSeconds: number
  // Enabled mp4 slots with a real file assigned whose duration hasn't
  // resolved (see effectiveMp4Seconds below) - excluded from
  // totalSeconds rather than guessed at, surfaced here so the caller
  // can show an indicator instead of silently under-counting.
  unknownDurationCount: number
}

// Same "file's own detected length wins over the slot's own
// durationSeconds column" rule MediaPanel.tsx's live rotation timer and
// tenant/carousel/index.ts's own PUT budget check both already use for
// mp4 - kept in agreement deliberately rather than re-derived, so this
// total never disagrees with what actually plays. Unlike those two
// callers, this one does NOT fall back to slot.durationSeconds when the
// file's duration is unknown - see this hook's own file-level comment
// for why silently guessing would misrepresent the total instead of
// just being imprecise.
function effectiveMp4Seconds(slot: CarouselSlot, files: MediaLibraryFile[]): number | 'unknown' | null {
  if (!slot.mediaLibraryId) return null // no file assigned yet - nothing to time, not "unknown"
  const file = files.find((f) => f.id === slot.mediaLibraryId)
  return file?.mp4DurationSeconds ? file.mp4DurationSeconds : 'unknown'
}

// Shared by both Dashboard Manager (carousel_slots) and Cafe Media
// (cafe_carousel_slots) - the two tables are a deliberate structural
// mirror (migration 0037's own comment) and both are represented by
// the same CarouselSlot type, so one hook works unmodified for both.
// The only real divergence is isReserved, which café's own slots never
// set (CarouselSlot.isReserved's own comment: "only ever from
// tenant/carousel/index.ts's own GET, never cafe-carousel's") - so for
// café every slot simply falls through to the plain enabled-only path
// below, with no special-casing needed here.
export function useTotalLoopTime(slots: CarouselSlot[], files: MediaLibraryFile[]): TotalLoopTimeResult {
  return useMemo(() => {
    let totalSeconds = 0
    let unknownDurationCount = 0

    for (const slot of slots) {
      if (slot.isReserved) {
        totalSeconds += RESERVED_SLOT_SECONDS
        continue
      }
      if (!slot.enabled) continue

      if (slot.mediaType === 'mp4') {
        const seconds = effectiveMp4Seconds(slot, files)
        if (seconds === 'unknown') {
          unknownDurationCount += 1
        } else if (seconds !== null) {
          totalSeconds += seconds
        }
        continue
      }

      totalSeconds += slot.durationSeconds
    }

    return { totalSeconds, unknownDurationCount }
  }, [slots, files])
}

// "4m 32s" / "45s" / "1h 2m 15s" - omits leading zero-value units
// (never "0h 4m 32s") but always keeps seconds, even at 0 (e.g. "5m
// 0s"), so the string never looks truncated mid-unit.
export function formatLoopDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const parts: string[] = []
  if (hours) parts.push(`${hours}h`)
  if (hours || minutes) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}
