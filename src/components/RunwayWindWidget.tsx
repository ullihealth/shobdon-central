import { useMemo } from 'react'
import type { RunwayGroup } from '../types/clubProfile'
import type { WeatherData } from '../types/weather'
import { calculateWindComponents } from '../utils/windCalculations'
import runwayImg from './Windsock/Runway.png'
import windsockFullImg from './Windsock/Windsock full.png'
import windsockMediumImg from './Windsock/Windsock medium.png'
import windsockDroopedImg from './Windsock/Windsock drooped.png'

export interface WindsockThresholds {
  fullKt: number
  mediumKt: number
}

interface RunwayWindWidgetProps {
  group: RunwayGroup
  // opsPanel.activeRunwayEnd - same source RunwayInUseCard/CompassPanel
  // already read. Falls back to endAIdentifier if it matches neither end
  // (empty/not-yet-loaded), same convention CompassPanel's own
  // resolvedRunwayHeading uses.
  activeEnd: string
  // opsPanel.circuitDirection - same 'left'|'right' field/source
  // RunwayInUseCard.tsx already reads (migrations/0009_ops_panel_state.sql).
  // One airfield-wide value, not per-runway - same posture as activeEnd.
  circuitDirection: string
  weather: WeatherData | null
  liveDataUnavailable: boolean
  windsock: WindsockThresholds
  // Pilot View mobile round: this widget now sits directly on the page
  // background there (no card/border, full page width), below the
  // restored compass, in place of its old text readout row - a visually
  // different context from /runway-widget-test's own centred half-width
  // card, which is unaffected (every existing caller omits this and
  // keeps the original chrome). Sizing is also fixed/larger when true,
  // not just chrome-less - the old mobile-default sizes were tuned to
  // fit two columns inside a padded half-width card, noticeably smaller
  // than the room a full-width, no-padding layout actually has to work
  // with now.
  bare?: boolean
}

type ArrowColour = 'green' | 'red' | 'amber'

// How close the wind needs to be to exactly perpendicular (90°/270° off
// the runway heading) before this widget calls it "crosswind-dominant"
// (amber) rather than a green/red headwind-or-tailwind reading. Real
// wind direction almost never lands on precisely 90°, so a hard equality
// check would make amber nearly unreachable - +/-5° (an 85-95° / 265-
// 275° band) is generous enough to catch a genuinely close-to-
// perpendicular wind without also swallowing winds that are meaningfully
// still a head/tailwind with a bit of drift.
const CROSSWIND_TOLERANCE_DEGREES = 5

function determineArrowColour(headwind: number, windDirection: number, runwayHeading: number): ArrowColour {
  const relative = (((windDirection - runwayHeading) % 360) + 360) % 360
  const distanceTo90 = Math.abs(relative - 90)
  const distanceTo270 = Math.abs(relative - 270)
  if (Math.min(distanceTo90, distanceTo270) <= CROSSWIND_TOLERANCE_DEGREES) return 'amber'
  // "However small" per the spec - any non-negative headwind component
  // is green, any negative (tailwind) is red, no dead zone around zero
  // beyond the crosswind band already carved out above.
  return headwind >= 0 ? 'green' : 'red'
}

const ARROW_COLOUR_CLASS: Record<ArrowColour, string> = {
  green: 'text-status-good',
  red: 'text-status-bad',
  amber: 'text-amber-400',
}

// Crosswind/Trend readouts are deliberately always this one accent
// colour, not traffic-light-coded like Headwind - the windsock image
// itself already visually carries crosswind strength/direction, so the
// text beside it doesn't need a second, redundant safety signal. Same
// literal class as ARROW_COLOUR_CLASS.amber, reused rather than
// duplicated as a value.
const ACCENT_CLASS = 'text-amber-400'

// Circuit gets its own distinct colour (blue), not ACCENT_CLASS's amber -
// it's not a wind reading at all (unlike Crosswind/Trend, which share
// that amber precisely because neither is traffic-light-safety-coded),
// so visually grouping it with them would misleadingly imply it's part
// of the same "wind readout" family. Reuses the exact accent-sky-400
// token already established elsewhere in this app (e.g. Pilot View's
// Notices section title) rather than an approximated blue.
const CIRCUIT_CLASS = 'text-accent-sky-400'

// 'Left-hand'/'Right-hand' - deliberately different formatting from
// RunwayInUseCard.tsx's own handLabel() ('LEFT HAND'/'RIGHT HAND', all
// caps) even though both read the same underlying 'left'|'right' value -
// this widget's own title/value casing convention (Title Case labels,
// not all-caps) already differs from that card's, so matching this
// widget's own style here is more consistent than matching that other
// component's.
function circuitLabelFor(direction: string): string {
  return direction === 'right' ? 'Right-hand' : 'Left-hand'
}

type WindsockStrength = 'full' | 'medium' | 'drooped'

function determineWindsockStrength(crosswindKt: number, thresholds: WindsockThresholds): WindsockStrength {
  const magnitude = Math.abs(crosswindKt)
  if (magnitude >= thresholds.fullKt) return 'full'
  if (magnitude >= thresholds.mediumKt) return 'medium'
  return 'drooped'
}

const WINDSOCK_IMAGE: Record<WindsockStrength, string> = {
  full: windsockFullImg,
  medium: windsockMediumImg,
  drooped: windsockDroopedImg,
}

function trendLabelFor(trend: WeatherData['pressureTrend'] | undefined): string {
  if (trend === 'rising') return 'Rising'
  if (trend === 'falling') return 'Falling'
  return 'Steady'
}

// Down-pointing chevron/arrowhead - sits between the Headwind value and
// the runway image per the approved layout. Deliberately never rotates
// (the windsock already carries left/right crosswind direction via its
// own mirroring below; this arrow's only job is headwind/tailwind/
// crosswind STATE via colour, not a compass-accurate bearing).
function ArrowIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 48 64" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 62 L2 34 H15 V2 H33 V34 H46 Z" fill="currentColor" />
    </svg>
  )
}

// Two columns: Crosswind reading + windsock + Circuit + Trend on the
// left, Headwind reading + arrow + runway image (with the active end's
// identifier overlaid) on the right. See RunwayWidgetTestPage.tsx (the
// original standalone prototype route, still live) and PilotRunwayWindPanel.tsx
// (the /pilot mobile integration) for this component's two real callers -
// both own their own page-level "Wind" reading above this widget, see
// either file's own comment.
//
// Mobile-first sizing (text-sm/h-16/w-36 etc by default, larger again at
// `sm:`) - not tuned to one context. /pilot renders this below `sm:`
// width on a real phone, where the original desktop-only sizes (tuned
// against /runway-widget-test's own wide, non-mobile viewport) were
// comfortably wider than the whole page content column and would have
// overflowed/forced horizontal scroll; the test page itself is always
// viewed well above `sm:` width, so its own appearance is unchanged by
// this - same "mobile default, sm:-gated desktop size" technique
// CompassPanel.tsx's own instrument sizing already established earlier
// this session, reused here rather than a new one-off pattern.
export default function RunwayWindWidget({ group, activeEnd, circuitDirection, weather, liveDataUnavailable, windsock, bare = false }: RunwayWindWidgetProps): JSX.Element {
  // opsPanel.activeRunwayEnd is a single airfield-wide field (see
  // RunwayInUseCard.tsx's own comment on ops_panel_state) - it was only
  // ever designed around one physical runway (CompassPanel.tsx only ever
  // reads runwayGroups[0]). For a genuinely different second runway
  // whose own ends don't include activeEnd at all, falling back to it
  // verbatim would show an identifier that doesn't belong to this strip
  // (e.g. "26" painted on a 14/32 runway) - only trust activeEnd when it
  // actually names one of THIS group's own two ends; otherwise default
  // to this group's own endAIdentifier, same as the heading fallback
  // immediately below already does.
  const activeIdentifier = activeEnd === group.endAIdentifier || activeEnd === group.endBIdentifier ? activeEnd : group.endAIdentifier

  // Same endB-matching convention as CompassPanel.tsx's own
  // resolvedRunwayHeading - endAIdentifier's heading is the only one
  // ever stored; the reciprocal end is that heading +180.
  const runwayHeading = useMemo(() => {
    return activeEnd === group.endBIdentifier ? (group.headingDegrees + 180) % 360 : group.headingDegrees
  }, [activeEnd, group.endBIdentifier, group.headingDegrees])

  const hasWind = !!weather && !liveDataUnavailable

  const { headwind, crosswind } = useMemo(() => {
    if (!hasWind || !weather) return { headwind: 0, crosswind: 0 }
    return calculateWindComponents(weather.windSpeed, weather.windDirection, runwayHeading)
  }, [hasWind, weather, runwayHeading])

  const arrowColour: ArrowColour = hasWind && weather ? determineArrowColour(headwind, weather.windDirection, runwayHeading) : 'green'
  const windsockStrength = hasWind ? determineWindsockStrength(crosswind, windsock) : 'drooped'
  // crosswind > 0 = "from the right" (CompassPanel's own convention -
  // Right circuit / crosswind label uses the same sign). Every windsock
  // image ships pole-on-the-right, sock pointing left by default - a
  // sock physically points AWAY from where the wind is coming from, so
  // that default artwork already correctly depicts "wind from the
  // right" with no transform; mirroring it depicts "from the left".
  const mirrored = hasWind && crosswind < 0

  const chromeClass = bare ? 'flex w-full items-start justify-center gap-6' : 'flex items-start gap-4 rounded-2xl border border-border bg-panel p-4 sm:gap-8 sm:p-6'
  const titleClass = bare ? 'text-base font-bold uppercase tracking-wide text-muted-400' : 'text-xs font-bold uppercase tracking-wide text-muted-400 sm:text-2xl'
  const bigValueClass = bare ? 'text-2xl font-black' : 'text-base font-black'
  const bigValueSmClass = bare ? '' : ' sm:text-4xl'
  const smallValueClass = bare ? 'text-xl font-black' : 'text-sm font-black'
  const smallValueSmClass = bare ? '' : ' sm:text-3xl'
  const windsockClass = bare ? 'h-24 w-auto object-contain' : 'h-16 w-auto object-contain sm:h-28'
  const subBlockClass = bare ? 'mt-3 flex flex-col items-center gap-1' : 'mt-2 flex flex-col items-center gap-1 sm:mt-4'
  const arrowClass = bare ? 'h-8 w-6' : 'h-6 w-5 sm:h-10 sm:w-8'
  const runwayWrapClass = bare ? 'relative w-48' : 'relative w-36 sm:w-64'
  const identifierClass = bare
    ? 'absolute inset-x-0 top-[14%] text-center text-3xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]'
    : 'absolute inset-x-0 top-[14%] text-center text-xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:text-4xl'

  return (
    <div className={chromeClass}>
      {/* Left column: Crosswind + windsock + Circuit + Trend. items-start
          on the outer flex row (not items-center) is what lets this
          shorter column sit top-aligned beside the taller runway column
          instead of being vertically centred against it - matches the
          approved mockup, where Trend sits roughly level with the runway
          image's midpoint, not its own column's full height. */}
      <div className={`flex flex-col items-center ${bare ? 'gap-2' : 'gap-1 sm:gap-2'}`}>
        <span className={titleClass}>Crosswind</span>
        <span className={`${bigValueClass} ${ACCENT_CLASS}${bigValueSmClass}`}>
          {hasWind ? `${Math.abs(crosswind).toFixed(1)} kts ${crosswind >= 0 ? 'Right' : 'Left'}` : 'N/A'}
        </span>
        <img
          src={WINDSOCK_IMAGE[windsockStrength]}
          alt={`Windsock, ${windsockStrength}`}
          className={windsockClass}
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
        />
        {/* Circuit - not a wind reading at all (see CIRCUIT_CLASS's own
            comment for why it gets its own colour rather than sharing
            ACCENT_CLASS with Crosswind/Trend), but placed in this same
            column/stack per the approved mockup, between the windsock
            and Trend. */}
        <div className={subBlockClass}>
          <span className={titleClass}>Circuit</span>
          <span className={`${smallValueClass} ${CIRCUIT_CLASS}${smallValueSmClass}`}>{circuitLabelFor(circuitDirection)}</span>
        </div>
        <div className={subBlockClass}>
          <span className={titleClass}>Trend</span>
          <span className={`${smallValueClass} ${ACCENT_CLASS}${smallValueSmClass}`}>{hasWind ? trendLabelFor(weather?.pressureTrend) : 'N/A'}</span>
        </div>
      </div>

      {/* Right column: Headwind + arrow + runway. Deliberately a static
          "Headwind" label regardless of sign (not a Headwind/Tailwind
          swap) - the colour (green/red/amber, same ARROW_COLOUR_CLASS as
          the arrow itself) already unambiguously carries which one it
          actually is, per the approved mockup. Runway image sized ~2x
          the windsock's own height at every breakpoint/mode -
          "noticeably larger" per the spec, not a precise ratio. */}
      <div className={`flex flex-col items-center ${bare ? 'gap-2' : 'gap-1 sm:gap-2'}`}>
        <span className={titleClass}>Headwind</span>
        <span className={`${bigValueClass} ${ARROW_COLOUR_CLASS[arrowColour]}${bigValueSmClass}`}>
          {hasWind ? `${Math.abs(headwind).toFixed(1)} kts` : 'N/A'}
        </span>
        <ArrowIcon className={`${arrowClass} ${ARROW_COLOUR_CLASS[arrowColour]}`} />
        <div className={runwayWrapClass}>
          <img src={runwayImg} alt={`Runway ${activeIdentifier}`} className="w-full" />
          {/* Positioned in the clear tarmac area between the top of the
              image and the threshold stripes (which sit roughly in the
              lower-middle third of Runway.png) - "ahead of" them per the
              spec, never overlapping. */}
          <div className={identifierClass}>{activeIdentifier || '--'}</div>
        </div>
      </div>
    </div>
  )
}
