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
  // opsPanel.reverseCompassNeedle - the SAME per-tenant flag CompassPanel.tsx
  // already applies to its own headwind/crosswind maths (not just its
  // arrow's visual rotation, despite this file's own earlier comment
  // claiming otherwise - see the round that traced and corrected this).
  // Genuinely required for correctness: it means the stored heading data
  // itself is known to be backwards for this physical station, so the
  // real-world-correct runway heading isn't resolvedRunwayHeading alone,
  // it's that value plus another 180° when this flag is set. Currently
  // true for Shobdon.
  reverseCompassNeedle: boolean
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

// Two columns, each a self-contained stack: Crosswind reading + windsock
// + Trend on the left, Headwind reading + arrow + runway image (with
// the active end's identifier overlaid) + Circuit on the right. See
// RunwayWidgetTestPage.tsx (the
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
export default function RunwayWindWidget({ group, activeEnd, circuitDirection, reverseCompassNeedle, weather, liveDataUnavailable, windsock, bare = false }: RunwayWindWidgetProps): JSX.Element {
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
  // ever stored; the reciprocal end is that heading +180. reverseCompassNeedle
  // is then applied on top, exactly as CompassPanel.tsx does before its own
  // calculateWindComponents call - genuinely required for correctness, not
  // optional, wherever this data's own reverseCompassNeedle flag is set.
  // Confirmed the hard way: this widget originally omitted this correction
  // entirely (on the mistaken belief the flag only affects CompassPanel's
  // arrow rotation), which silently inverted Headwind/Tailwind colour and
  // the windsock's mirror direction for Shobdon specifically, since its
  // real production runway_groups row and this flag are only consistent
  // with each other once both corrections are applied together.
  const runwayHeading = useMemo(() => {
    const resolved = activeEnd === group.endBIdentifier ? (group.headingDegrees + 180) % 360 : group.headingDegrees
    return reverseCompassNeedle ? (resolved + 180) % 360 : resolved
  }, [activeEnd, group.endBIdentifier, group.headingDegrees, reverseCompassNeedle])

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

  // Round 2 size-up (~10-20% over the first bare pass) achieved by
  // shrinking the gap BETWEEN the two columns (gap-6 -> gap-3), not by
  // adding horizontal padding to the outer container (bare has none,
  // deliberately, so this stays flush with every other full-width
  // section on the page) - freed-up width goes straight to the content
  // itself rather than sitting unused as a wider gutter.
  // outerClass carries the card border/bg/padding in non-bare mode
  // (/runway-widget-test's own centred card look) - moved here from the
  // top-row-only div it used to live on, round 4's own fix for a real
  // regression: with Circuit/Trend pulled out into their own row below
  // the two columns, they'd otherwise render outside/below the card
  // entirely, on the bare page background, in non-bare mode specifically.
  // topRowClass is now just the two-column row's own layout, no chrome.
  const outerClass = bare ? 'flex w-full flex-col items-center' : 'flex flex-col items-center rounded-2xl border border-border bg-panel p-4 sm:p-6'
  const topRowClass = bare ? 'flex w-full items-start justify-center gap-3' : 'flex items-start justify-center gap-4 sm:gap-8'
  const titleClass = bare ? 'text-lg font-bold uppercase tracking-wide text-muted-400' : 'text-xs font-bold uppercase tracking-wide text-muted-400 sm:text-2xl'
  // One shared value size for all four readouts (Crosswind/Headwind/
  // Circuit/Trend) - round 3 explicitly asked for Circuit/Trend to match
  // Crosswind/Headwind exactly, not just visually close, so this is the
  // same class object reused, not two independently-tuned ones that
  // could drift apart again later.
  const valueClass = bare ? 'text-[27px] font-black' : 'text-base font-black'
  const valueSmClass = bare ? '' : ' sm:text-4xl'
  // Windsock enlarged (h-28 -> h-40, was noticeably smaller than the
  // runway image next to it) - Windsock full.png/medium/drooped are all
  // roughly square (~817x812 etc), so this renders about as wide as it
  // is tall, comparable in visual weight to the runway image now that
  // each sits alone atop its own column instead of sharing a column with
  // three other stacked text blocks.
  const windsockClass = bare ? 'h-40 w-auto object-contain' : 'h-16 w-auto object-contain sm:h-28'
  // Round 5: Circuit and Trend swapped AND moved off their shared row,
  // each now a literal child of its own top column (Trend under
  // Crosswind/windsock, Circuit under Headwind/runway) - this guarantees
  // exact horizontal centering under that column regardless of how much
  // wider the runway column is than the windsock column, which a
  // separate shared row (the previous approach) could only approximate.
  // bottomItemClass is that per-column wrapper - same margin-top the old
  // shared row used for separation from the content above it.
  const bottomItemClass = bare ? 'mt-6 flex flex-col items-center gap-1' : 'mt-2 flex flex-col items-center gap-1 sm:mt-4'
  const arrowClass = bare ? 'h-9 w-7' : 'h-6 w-5 sm:h-10 sm:w-8'
  const runwayWrapClass = bare ? 'relative w-56' : 'relative w-36 sm:w-64'
  const identifierClass = bare
    ? 'absolute inset-x-0 top-[14%] text-center text-[34px] font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]'
    : 'absolute inset-x-0 top-[14%] text-center text-xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] sm:text-4xl'

  // Round 4: windsock nudged down (margin-top only - its own size and
  // the Crosswind title/value above it are untouched) so its top edge
  // lines up with the runway image's top edge next to it. The two
  // columns aren't naturally aligned without this: the runway column has
  // an extra element (the arrow icon) between its value and its image
  // that the windsock column doesn't, so the windsock image would
  // otherwise start noticeably higher. Value empirically measured
  // against the actual rendered arrow height/gap, not guessed.
  const windsockOffsetClass = bare ? 'mt-11' : ''

  return (
    <div className={outerClass}>
      <div className={topRowClass}>
        {/* Left column: Crosswind + windsock + Trend (swapped in from the
            right column, round 5 - Trend is embedded as a literal child
            here, not a separate row, so it centers exactly under this
            column regardless of the two columns' differing widths). */}
        <div className={`flex flex-col items-center ${bare ? 'gap-2' : 'gap-1 sm:gap-2'}`}>
          <span className={titleClass}>Crosswind</span>
          <span className={`${valueClass} ${ACCENT_CLASS}${valueSmClass}`}>
            {hasWind ? `${Math.abs(crosswind).toFixed(1)} kts ${crosswind >= 0 ? 'Right' : 'Left'}` : 'N/A'}
          </span>
          <img
            src={WINDSOCK_IMAGE[windsockStrength]}
            alt={`Windsock, ${windsockStrength}`}
            className={`${windsockClass} ${windsockOffsetClass}`}
            style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
          />
          <div className={bottomItemClass}>
            <span className={titleClass}>Trend</span>
            <span className={`${valueClass} ${ACCENT_CLASS}${valueSmClass}`}>{hasWind ? trendLabelFor(weather?.pressureTrend) : 'N/A'}</span>
          </div>
        </div>

        {/* Headwind is deliberately a static label regardless of sign
            (not a Headwind/Tailwind swap) - the colour (green/red/amber,
            same ARROW_COLOUR_CLASS as the arrow itself) already
            unambiguously carries which one it actually is. Right column:
            Headwind + arrow + runway + Circuit (swapped in from the left
            column, round 5 - same embedded-child approach as Trend
            above, for the same exact-centering reason). */}
        <div className={`flex flex-col items-center ${bare ? 'gap-2' : 'gap-1 sm:gap-2'}`}>
          <span className={titleClass}>Headwind</span>
          <span className={`${valueClass} ${ARROW_COLOUR_CLASS[arrowColour]}${valueSmClass}`}>
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
          <div className={bottomItemClass}>
            <span className={titleClass}>Circuit</span>
            <span className={`${valueClass} ${CIRCUIT_CLASS}${valueSmClass}`}>{circuitLabelFor(circuitDirection)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
