export interface WindComponents {
  headwind: number
  crosswind: number
}

export type ArrowColour = 'green' | 'amber' | 'red'

// Tenant-configurable (migration 0081, arrow_tailwind_kt/arrow_crosswind_kt/
// arrow_headwind_kt on `tenants`) - developer-editable only via direct D1
// update, no self-service UI. All three are positive kt magnitudes; the
// sign/direction of each (e.g. tailwind being a NEGATIVE headwind
// component) is handled below, not in the stored/passed value. Exported
// (rather than duplicated per-caller the way this codebase's other
// tenant-configurable defaults, e.g. RunwayWindWidget.tsx's own
// DEFAULT_WINDSOCK, usually are) because this is also determineArrowColour's
// own runtime default parameter below, not just a UI placeholder value -
// hand-duplicating it risks a caller silently drifting out of sync with
// the function's actual default behaviour if it's ever changed here.
export interface ArrowColourThresholds {
  tailwindKt: number
  crosswindKt: number
  headwindKt: number
}

export const DEFAULT_ARROW_THRESHOLDS: ArrowColourThresholds = { tailwindKt: 2, crosswindKt: 5, headwindKt: 3 }

const CARDINAL_POINTS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
]

export function calculateWindComponents(
  windSpeed: number,
  windDirection: number,
  runwayHeading: number
): WindComponents {
  const windRadians = (windDirection * Math.PI) / 180
  const runwayRadians = (runwayHeading * Math.PI) / 180

  const headwind = windSpeed * Math.cos(windRadians - runwayRadians)
  const crosswind = windSpeed * Math.sin(windRadians - runwayRadians)

  return { headwind, crosswind }
}

export function determineArrowColour(
  headwind: number,
  crosswind: number,
  thresholds: ArrowColourThresholds = DEFAULT_ARROW_THRESHOLDS
): ArrowColour {
  const absCrosswind = Math.abs(crosswind)

  if (headwind < -thresholds.tailwindKt) {
    return 'red'
  }

  if (absCrosswind > thresholds.crosswindKt) {
    return 'amber'
  }

  if (headwind < thresholds.headwindKt && headwind >= -thresholds.tailwindKt) {
    return 'amber'
  }

  return 'green'
}

export function degreesToCardinal(degrees: number): string {
  const normalised = ((degrees % 360) + 360) % 360
  const index = Math.round(normalised / 22.5) % 16
  return CARDINAL_POINTS[index]
}

// Shared /runways round: the "which way does the active runway end
// actually point" formula CompassPanel.tsx and RunwayWindWidget.tsx each
// already implement independently (endAIdentifier's own heading is the
// only one ever stored - the reciprocal end is that heading +180 - then
// reverseCompassNeedle applies another 180 on top when this tenant's own
// station data is known to be backwards). That duplication has already
// caused one real bug (see PilotRunwayWindPanel.tsx's own comment - a
// production tenant's inverted Headwind/Tailwind result before both
// copies were corrected to apply reverseCompassNeedle consistently).
// This is for RunwaysPage.tsx's own new Runway-mode toggle to use
// instead of writing a third hand-copied version - the two existing
// copies are left as-is (already correct, already tested) rather than
// retrofitted onto this, which would be a larger, separately-scoped
// change.
export function resolveActiveRunwayHeading(
  endAIdentifier: string,
  endBIdentifier: string,
  headingDegrees: number,
  activeEnd: string,
  reverseCompassNeedle: boolean
): number {
  const resolved = activeEnd === endBIdentifier ? (headingDegrees + 180) % 360 : headingDegrees
  return reverseCompassNeedle ? (resolved + 180) % 360 : resolved
}
