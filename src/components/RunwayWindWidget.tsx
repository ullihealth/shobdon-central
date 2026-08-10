import { useMemo } from 'react'
import type { RunwayGroup } from '../types/clubProfile'
import type { WeatherData } from '../types/weather'
import { calculateWindComponents, determineArrowColour } from '../utils/windCalculations'
import type { ArrowColour, ArrowColourThresholds } from '../utils/windCalculations'
import runwayImg from './Windsock/Runway.png'
import windsock1Img from './Windsock/windsock-1.png'
import windsock2Img from './Windsock/windsock-2.png'
import windsock3Img from './Windsock/windsock-3.png'
import windsock4Img from './Windsock/windsock-4.png'
import windsock5Img from './Windsock/windsock-5.png'

// 5-tier windsock (migration 0079), replacing the old 2-threshold/
// 3-image system. bandNKt = crosswind speed (kt) at/above which
// windsock-N.png shows instead of windsock-(N-1).png; windsock-1.png
// itself has no threshold of its own (below band2Kt).
export interface WindsockThresholds {
  band2Kt: number
  band3Kt: number
  band4Kt: number
  band5Kt: number
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
  // Tenant-configurable (migration 0081), developer-editable only via
  // direct D1 update - see windCalculations.ts's own comment. Required,
  // not defaulted here - same posture as windsock above; each caller
  // resolves its own fallback (DEFAULT_ARROW_THRESHOLDS, imported from
  // windCalculations.ts) before passing this down, same as windsock's
  // own DEFAULT_WINDSOCK pattern in those same callers.
  arrowThresholds: ArrowColourThresholds
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
  // Desktop-dashboard round (CompassPanel.tsx, squeezed beside the
  // compass instrument in a fixed-height flex slot) - non-bare's own
  // existing sizing scales UP again at sm: and above (tuned for
  // /runway-widget-test's own generous, unconstrained page), which is
  // exactly the viewport width this new caller renders at, so the
  // "smaller" non-bare tier ended up just as tall as bare there and
  // genuinely overflowed its slot (confirmed by direct measurement: the
  // widget rendered ~30px taller than the space available, clipping
  // Crosswind/Headwind off the top). compact stays at non-bare's own
  // BASE (pre-sm:) sizing regardless of viewport width - every existing
  // caller (bare or non-bare) omits this and is completely unaffected;
  // it only ever modifies the non-bare branch's own class strings below.
  compact?: boolean
}

// Was this widget's own locally-defined, angle-based (within 5° of
// perpendicular) implementation, diverging from CompassPanel.tsx's
// crosswind-kt + headwind-kt hybrid despite sharing a name - the two
// could disagree on colour for the same wind. Consolidated onto the
// shared windCalculations.ts version (imported above) so this widget's
// arrow and the compass needle always agree.
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

type WindsockTier = 1 | 2 | 3 | 4 | 5

function determineWindsockTier(crosswindKt: number, thresholds: WindsockThresholds): WindsockTier {
  const magnitude = Math.abs(crosswindKt)
  if (magnitude >= thresholds.band5Kt) return 5
  if (magnitude >= thresholds.band4Kt) return 4
  if (magnitude >= thresholds.band3Kt) return 3
  if (magnitude >= thresholds.band2Kt) return 2
  return 1
}

const WINDSOCK_IMAGE: Record<WindsockTier, string> = {
  1: windsock1Img,
  2: windsock2Img,
  3: windsock3Img,
  4: windsock4Img,
  5: windsock5Img,
}

// Pole-centring round (compact only): every windsock-N.png ships "pole
// on the right, fabric extends left" (see mirrored's own comment below)
// at a fixed real-world pole position, only the fabric's own extent -
// and thus the image's own bounding-box WIDTH - grows with wind
// strength. Confirmed by direct pixel analysis of all five PNGs
// (opaque region in each image's own bottom 10%, where only the pole
// itself is visible, no fabric reaching that low): the pole's centre
// sits 74-75px from the image's own right edge in every tier, to within
// half a pixel - NOT a fixed fraction of width, which is why centring
// the image's own bounding box (what plain flex item-centering does)
// visibly shifts the pole left/right as the tier changes with crosswind
// strength. Height is 812px in every tier (only width varies), so this
// offset scales identically for every tier at any given rendered
// height - no per-tier lookup needed for it, unlike width.
const WINDSOCK_NATURAL_HEIGHT_PX = 812
const WINDSOCK_NATURAL_WIDTH_PX: Record<WindsockTier, number> = { 1: 520, 2: 661, 3: 786, 4: 817, 5: 810 }
const WINDSOCK_POLE_OFFSET_FROM_RIGHT_PX = 74.5
// Matches windsockClass's own compact-tier height below - the two must
// stay in sync (this is the rendered height the pole correction scales
// against), kept as its own named constant rather than parsed back out
// of that class string. Deliberately NOT a plain 9 (h-36) - Runway.png
// is not quite square (2348 x 2352px), so at the runway wrap's own
// w-36 (9rem) its TRUE rendered height is 9 * 2352/2348 = 9.01533rem,
// not exactly 9rem. A flat h-36 on the windsock left it ~0.2px shorter
// than the runway image beside it, which then propagated 1:1 into a
// small but real gap between Trend and Circuit (each just mt-2 below
// its own column's image) - this constant, used for BOTH windsockClass
// and the pole-correction maths below, is Runway.png's own true aspect
// ratio applied to the same 9rem base, so the two images render at
// EXACTLY the same height, not just visually close.
const WINDSOCK_COMPACT_HEIGHT_REM = (9 * 2352) / 2348

// Plain flex item-centering puts the IMAGE's own geometric centre (not
// the pole) on the column's centreline - offset between the two, in
// rem, for a given tier at the compact render height. Always applied as
// an ADDITIONAL translateX after any mirroring scaleX (see the actual
// style prop below) - translate composes as a final, unscaled shift
// regardless of a preceding negative scale, so the same signed value
// pushes the pole exactly back onto the centreline whether the tier is
// mirrored or not (mirroring itself reflects the pole to the opposite
// side of the image's own centre, flipping the CORRECTION's own
// required sign, not just the artwork).
function windsockPoleCorrectionRem(tier: WindsockTier): number {
  const renderedWidthRem = (WINDSOCK_COMPACT_HEIGHT_REM * WINDSOCK_NATURAL_WIDTH_PX[tier]) / WINDSOCK_NATURAL_HEIGHT_PX
  const poleOffsetFromRightRem = (WINDSOCK_COMPACT_HEIGHT_REM * WINDSOCK_POLE_OFFSET_FROM_RIGHT_PX) / WINDSOCK_NATURAL_HEIGHT_PX
  return renderedWidthRem / 2 - poleOffsetFromRightRem
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
export default function RunwayWindWidget({
  group,
  activeEnd,
  circuitDirection,
  reverseCompassNeedle,
  weather,
  liveDataUnavailable,
  windsock,
  arrowThresholds,
  bare = false,
  compact = false,
}: RunwayWindWidgetProps): JSX.Element {
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

  const arrowColour: ArrowColour = hasWind ? determineArrowColour(headwind, crosswind, arrowThresholds) : 'green'
  const windsockTier = hasWind ? determineWindsockTier(crosswind, windsock) : 1
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
  // compact round: desktop-dashboard's own caller floats directly on the
  // page background, same as the compass instrument beside it - no card
  // border/bg/padding, same chromeless treatment bare already has, just
  // with compact's own smaller (non-bare) sizing everywhere else below.
  // Deliberately NOT bare's own w-full here (layout-fix round) - bare's
  // only caller is a full-width mobile page section with nothing beside
  // it, but compact's caller is a flex sibling of the compass instrument
  // in the same row; w-full there made this div claim the ENTIRE row's
  // width instead of just its own content's width, squeezing/shifting
  // the compass beside it. Content-sized (no explicit width), same as
  // the card variant this replaced.
  const outerClass = bare
    ? 'flex w-full flex-col items-center'
    : `flex flex-col items-center${compact ? '' : ' rounded-2xl border border-border bg-panel p-4 sm:p-6'}`
  // compact: gap-16 (was gap-4/1rem, +3rem) - the gap between this row's
  // two columns (Crosswind/windsock/Trend, Runway/Headwind/Circuit).
  // Deliberately the SAME +3rem delta as CompassPanel.tsx's own outer
  // row gap (see that file's own comment on the maths) - increasing both
  // by an equal amount is what keeps the left column anchored at its
  // previous position while the compass (that other gap's other side)
  // and this row's right column both move outward by the full delta.
  const topRowClass = bare
    ? 'flex w-full items-start justify-center gap-3'
    : `flex items-start justify-center ${compact ? 'gap-16' : 'gap-4 sm:gap-8'}`
  // compact: text-sm (14px) instead of the base text-xs (12px) - a +2px
  // bump for readability at TV/kiosk viewing distance, Crosswind/
  // Headwind/Trend/Circuit only (their value text below, e.g. "2.3 kts
  // Left"/"Steady", is untouched - valueClass isn't part of this
  // change). Non-compact (/runway-widget-test, bare) untouched - both
  // already have their own larger title sizing (sm:text-2xl / text-lg
  // respectively) tuned for a different context, not part of this
  // request.
  const titleClass = bare
    ? 'text-lg font-bold uppercase tracking-wide text-muted-400'
    : `${compact ? 'text-sm' : 'text-xs'} font-bold uppercase tracking-wide text-muted-400${compact ? '' : ' sm:text-2xl'}`
  // Trend/Circuit only, bare mode only - titleClass above stays exactly
  // as-is for Crosswind/Headwind (not part of the requested label list
  // this round). Non-bare (the /runway-widget-test prototype, the only
  // other caller) is untouched - Trend/Circuit have no equivalent title
  // anywhere on the real desktop dashboard to match against.
  const bottomTitleClass = bare ? 'text-xl font-bold uppercase tracking-wide text-muted-400' : titleClass
  // One shared value size for all four readouts (Crosswind/Headwind/
  // Circuit/Trend) - round 3 explicitly asked for Circuit/Trend to match
  // Crosswind/Headwind exactly, not just visually close, so this is the
  // same class object reused, not two independently-tuned ones that
  // could drift apart again later.
  const valueClass = bare ? 'text-[27px] font-black' : 'text-base font-black'
  const valueSmClass = bare || compact ? '' : ' sm:text-4xl'
  // Windsock enlarged (h-28 -> h-40, was noticeably smaller than the
  // runway image next to it) - the windsock-N.png set ranges from
  // ~520x812 (tier 1, least extended) up to ~817x812 (tier 4/5, roughly
  // square), so object-contain below sizes each consistently regardless
  // of which tier is showing, comparable in visual weight to the runway
  // image now that each sits alone atop its own column instead of
  // sharing a column with three other stacked text blocks.
  // compact: height comes from an inline style (see the <img> below),
  // not a Tailwind class - WINDSOCK_COMPACT_HEIGHT_REM is a computed,
  // non-literal value (Runway.png's true aspect ratio applied to 9rem,
  // see that constant's own comment), and Tailwind's JIT can only
  // generate CSS for arbitrary-value classes it can find as a literal
  // string at build time, not one assembled at runtime via template
  // interpolation - `h-[${x}rem]` would silently produce a class name
  // with no matching CSS rule. object-contain (no explicit height
  // class) is kept here for compact so the rest of this string still
  // applies its width/fit behaviour; the actual height is set via style.
  const windsockClass = bare ? 'h-40 w-auto object-contain' : compact ? 'w-auto object-contain' : 'h-16 w-auto object-contain sm:h-28'
  // Round 5: Circuit and Trend swapped AND moved off their shared row,
  // each now a literal child of its own top column (Trend under
  // Crosswind/windsock, Circuit under Headwind/runway) - this guarantees
  // exact horizontal centering under that column regardless of how much
  // wider the runway column is than the windsock column, which a
  // separate shared row (the previous approach) could only approximate.
  // bottomItemClass is that per-column wrapper - same margin-top the old
  // shared row used for separation from the content above it.
  const bottomItemClass = bare ? 'mt-6 flex flex-col items-center gap-1' : `mt-2 flex flex-col items-center gap-1${compact ? '' : ' sm:mt-4'}`
  // Round 6: bottomItemClass's shared mt-6 left Trend sitting one full
  // row above Circuit - the right column has an extra arrow icon plus a
  // taller runway image between its Headwind value and Circuit that the
  // left column's windsock doesn't have, so the same margin-top doesn't
  // land at the same vertical position on both sides. Bare-only,
  // Trend-only extra offset (Circuit keeps the original bottomItemClass
  // untouched, per the request - Trend moves down to meet it, not the
  // other way round), measured against the two columns' actual rendered
  // heights on a real /pilot page rather than guessed.
  const trendItemClass = bare ? 'mt-[66px] flex flex-col items-center gap-1' : bottomItemClass
  const arrowClass = bare ? 'h-9 w-7' : `h-6 w-5${compact ? '' : ' sm:h-10 sm:w-8'}`
  const runwayWrapClass = bare ? 'relative w-56' : `relative w-36${compact ? '' : ' sm:w-64'}`
  const identifierClass = bare
    ? 'absolute inset-x-0 top-[14%] text-center text-[34px] font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]'
    : `absolute inset-x-0 top-[14%] text-center text-xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]${compact ? '' : ' sm:text-4xl'}`

  // Round 4: windsock nudged down (margin-top only - its own size and
  // the Crosswind title/value above it are untouched) so its top edge
  // lines up with the runway image's top edge next to it. The two
  // columns aren't naturally aligned without this: the runway column has
  // an extra element (the arrow icon) between its value and its image
  // that the windsock column doesn't, so the windsock image would
  // otherwise start noticeably higher. Value empirically measured
  // against the actual rendered arrow height/gap, not guessed.
  // compact: mt-8 (2rem), not a magic pixel value - derived, not tuned.
  // Both columns share one gap before their image (gap-1 sm:gap-2, i.e.
  // 0.5rem at desktop width); the right column then has ONE more element
  // (the arrow icon, h-6 = 1.5rem) plus a SECOND copy of that same gap
  // before its own image. For the two images to start at the same
  // height, the left column's own margin has to make up exactly that
  // difference: (gap + arrowHeight) - nothing = 0.5rem + 1.5rem = 2rem
  // (mt-8 on Tailwind's spacing scale). Unlike a hardcoded px value, this
  // stays correct regardless of the page's actual root font-size (a
  // fixed px offset silently drifts if that ever changes - confirmed the
  // hard way: real Shobdon data measured a live root font-size of
  // 16.2px, not the assumed 16px, which alone accounted for a real ~5px
  // gap between the previous mt-[27px] and where the arrow+gap math
  // actually landed). Direct measurement against real Shobdon data after
  // this fix: windsock/runway top and bottom now agree to within
  // 0.02px - correspondingly, since Trend/Circuit are each just mt-2
  // below their own column's image with no other offset, this single
  // fix also brings those two rows into the same sub-0.03px agreement,
  // not a coincidence - same shared root cause as this constant's own
  // fix.
  const windsockOffsetClass = bare ? 'mt-11' : compact ? 'mt-8' : ''

  // Right column (Headwind/arrow/runway/Circuit) sits, by design, in a
  // row that's centred as a whole (CompassPanel's own outer flex row is
  // justify-center, so the compass instrument + this whole widget are
  // centred together) - there's real spare width inside the compass
  // card's own column that's never claimed, left as symmetric empty
  // margin on both sides rather than given to either side's content.
  // Desktop-dashboard round: shift ONLY this column visually rightward,
  // via transform (not a margin/gap change), so it doesn't touch the
  // row's own reserved layout width - a margin/gap-based push here would
  // widen the widget's own flex item, and since the outer row is
  // justify-center, that growth is split three ways (compass moves left,
  // AND this column moves right), which is exactly the "everything else
  // shifts too" outcome that was NOT wanted. transform leaves the
  // reserved box (and therefore the compass's own position, and the
  // centring maths for the row as a whole) completely untouched.
  // Correction round: the prior value (150.375) pushed the runway
  // image's own right edge flush against the compass card's own right
  // inner edge - but that card (ClassicTemplate's own rounded-xl
  // wrapper) has overflow: hidden, and "Circuit"/"Right-hand" (this same
  // shifted column's OWN children) can render wider than the runway
  // image itself, clipping past that edge instead of just touching it.
  // Pulled back by exactly the runway image's own rendered width
  // (145.796875px at a real Shobdon render, w-36/9rem at this file's own
  // measured 16.2px root font-size - see windsockOffsetClass's own
  // comment on why root font-size isn't safely assumed to be 16px) - so
  // the runway image's NEW right edge lands exactly where its own
  // PREVIOUS left edge was, one full image-width back toward the
  // windsock column, leaving genuine clearance for Circuit/Right-hand's
  // own text before the card's clipping edge.
  // Clearance round: nudged a further quarter of that same runway-image
  // width back to the right - the windsock's own bounding box grows
  // considerably wider in strong crosswind (tier 4's own 817px-natural-
  // width image, this file's own widest tier, vs tier 1's narrow
  // 520px), and at the previous position that growth started visually
  // crowding the runway graphic beside it. A quarter-width gap gives the
  // fully-extended sock real breathing room without undoing the
  // clipping fix above (still well short of the card's own right edge).
  const RUNWAY_IMAGE_WIDTH_PX = 145.796875
  const RUNWAY_GROUP_COMPACT_SHIFT_PX = 150.375 - RUNWAY_IMAGE_WIDTH_PX + RUNWAY_IMAGE_WIDTH_PX / 4

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
            src={WINDSOCK_IMAGE[windsockTier]}
            alt={`Windsock, tier ${windsockTier}`}
            className={`${windsockClass} ${windsockOffsetClass}`}
            style={{
              // compact only - see WINDSOCK_COMPACT_HEIGHT_REM's own
              // comment for why this can't be a Tailwind class.
              height: compact ? `${WINDSOCK_COMPACT_HEIGHT_REM}rem` : undefined,
              transform:
                [
                  // compact-only pole-centring correction (see that
                  // function's own comment) - applied as a translateX
                  // AFTER any mirroring scaleX below, so it's always an
                  // unscaled, absolute shift regardless of mirror state;
                  // mirroring itself flips which SIGN the correction
                  // needs (the pole moves to the image's opposite side),
                  // handled by the ternary here, not by the transform
                  // order.
                  compact ? `translateX(${(mirrored ? 1 : -1) * windsockPoleCorrectionRem(windsockTier)}rem)` : null,
                  mirrored ? 'scaleX(-1)' : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined,
            }}
          />
          <div className={trendItemClass}>
            <span className={bottomTitleClass}>Trend</span>
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
        <div
          className={`flex flex-col items-center ${bare ? 'gap-2' : 'gap-1 sm:gap-2'}`}
          style={{ transform: compact ? `translateX(${RUNWAY_GROUP_COMPACT_SHIFT_PX}px)` : undefined }}
        >
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
            <span className={bottomTitleClass}>Circuit</span>
            <span className={`${valueClass} ${CIRCUIT_CLASS}${valueSmClass}`}>{circuitLabelFor(circuitDirection)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
