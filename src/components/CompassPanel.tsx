import { useEffect, useMemo, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import type { RunwayGroup, RunwayStrip } from '../types/clubProfile'
import { calculateWindComponents, determineArrowColour, DEFAULT_ARROW_THRESHOLDS } from '../utils/windCalculations'
import type { ArrowColour, ArrowColourThresholds } from '../utils/windCalculations'
import type { PressureTrend } from '../types/weather'

interface CompassState {
  windSpeed: number
  windDirection: number
  pressureTrend: PressureTrend
  headwind: number
  crosswind: number
  arrowColour: ArrowColour
  // Compass-mode round - already computed below for the headwind/
  // crosswind maths, now also exposed so RUNWAY mode can rotate the
  // dial to bring this heading to the top.
  activeRunwayHeading: number
}

// Compass-mode round (/pilot only, gated behind the spacious prop below)
// - NORTH (default, today's only behaviour) keeps the dial at 0°; RUNWAY
// brings the live active-runway heading to the top instead. Persisted
// per pilot via localStorage - no manual tenant-id prefix needed since
// each tenant already lives on its own subdomain and localStorage is
// natively origin-scoped by the browser, so a single fixed key already
// gets correct per-tenant isolation for free.
type CompassMode = 'north' | 'runway'
const COMPASS_MODE_STORAGE_KEY = 'pilotCompassMode'

function loadStoredCompassMode(): CompassMode {
  if (typeof window === 'undefined') return 'north'
  try {
    return window.localStorage.getItem(COMPASS_MODE_STORAGE_KEY) === 'runway' ? 'runway' : 'north'
  } catch {
    return 'north'
  }
}

// Intermediate bearings for compass rose
const INTERMEDIATE_BEARINGS = [
  { degrees: 30, label: '03' },  // NNE
  { degrees: 60, label: '06' },  // ENE
  { degrees: 120, label: '12' }, // ESE
  { degrees: 150, label: '15' }, // SSE
  { degrees: 210, label: '21' }, // SSW
  { degrees: 240, label: '24' }, // WSW
  { degrees: 300, label: '30' }, // WNW
  { degrees: 330, label: '33' }, // NNW
]

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function circlePoint(
  centreX: number,
  centreY: number,
  radius: number,
  angleDegrees: number
): { x: number; y: number } {
  const radians = degreesToRadians(angleDegrees)
  return {
    x: centreX + radius * Math.sin(radians),
    y: centreY - radius * Math.cos(radians),
  }
}

// Matches the outer ring circle's own r="180" below. Cardinal letters are
// placed at a fraction of this, not a bare literal, so the two stay linked.
const RING_RADIUS = 180

// Sleap-style layout: N/E/S/W sit at the true outer rim (straddling the
// ring boundary itself, same as a real compass bezel), the degree/heading
// numbers occupy a smaller radius well inside that, and a band of short
// dashed tick marks separates the two label rings. Previously the
// cardinal letters sat at RING_RADIUS * 0.83 (≈149px) - actually CLOSER
// to centre than the degree-number ring (153px) and the tick-mark band
// (163-175px), not "near the rim" at all despite the old comment's claim.
// Since a runway strip's rendered length has no upper clamp (admin-
// configurable, deliberately unbounded - see MIN_STRIP_HALF_LENGTH's own
// comment), a sufficiently long strip only had to reach ~149px from
// centre to visually collide with the giant (fontSize 41) cardinal
// letters - just 34px past Shobdon's own real strip (stripLengthPx 230,
// half-length 115px). Moving the letters out to 168px adds ~19px of
// clearance and puts them outside the tick-mark band entirely, so a
// strip has to be substantially longer before it can reach them. (172px
// was tried first but clipped the top of "N" against the SVG's own
// viewport edge by under a pixel - pulled in 4px for headroom, verified
// via getBoundingClientRect that all four letters render fully on-screen
// with margin to spare at 168px.)
const CARDINAL_LETTER_RADIUS = RING_RADIUS - 12

// Sits just inside the outer ring's own stroke (RING_RADIUS=180, stroke
// centred on that radius), not inside the tick-mark band below - moved
// out from an earlier 148 (which put it inside the tick band, reading as
// one crowded cluster with the degree markers) to instead sit near the
// rim, closer to (though still angularly clear of, since these fall at
// 30/60/120/150/210/240/300/330 vs the cardinal letters' 0/90/180/270)
// the cardinal letter ring at CARDINAL_LETTER_RADIUS (168). An initial
// pass at 177 put these labels' own bounding box slightly past the
// ring's stroke at their widest points (two-digit text extending past
// its own centre point); pulled in to 172, confirmed via bounding-box
// measurement to sit fully inside the ring with no overlap.
const INTERMEDIATE_LABEL_RADIUS = 172

// The dashed separator band between the two label rings - clear gap on
// both sides (148 -> 156 is 8px, 163 -> 168 is 5px), replacing the old
// degree-marker span (163-175) which sat almost flush against the ring.
const TICK_MARK_INNER_RADIUS = 156
const TICK_MARK_OUTER_RADIUS = 163

// Pre-existing correction, preserved as-is at the new radius - likely
// compensating for dominantBaseline="middle" centering less reliably than
// textAnchor="middle" does across browsers (N/S never needed an equivalent
// horizontal nudge).
const CARDINAL_LETTER_VERTICAL_NUDGE = 8

const NORTH_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 0)
const EAST_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 90)
const SOUTH_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 180)
const WEST_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 270)

// Strip WIDTH is a per-strip field (RunwayStrip.widthPx) - each physical
// strip in a group (e.g. a narrower grass strip beside a wider tarmac
// one) is independently sized - see the width formula inside
// RunwayGroupGraphic below. Along-axis length is still shared per-group
// (see RUNWAY_STRIP_* below).

// Gap between the two strips of a twin group, in px - shared by Shobdon's
// real gap (verified: 203 - 198 = 5, exactly matching the strip geometry
// below at the seeded 22px width) and the general symmetric formula.
const RUNWAY_STRIP_GAP = 5

// Strip width (RunwayStrip.widthPx, per strip) and length
// (RunwayGroup.stripLengthPx, per group) are both admin-configurable with
// no upper bound - deliberately no longer clamped
// to any "safe distance from the cardinal letters" ceiling. Overlapping
// the ring or letters at an extreme value is the admin's own visual
// choice to make, not something to silently prevent. Only a small floor
// remains, and it exists purely to stop a degenerate/broken render (a
// zero or negative size, or the two numeral positions crossing over each
// other on a near-zero-length strip) - not to protect anyone from a large
// value.
const MIN_STRIP_HALF_LENGTH = 30
const MIN_STRIP_WIDTH_PX = 4

function clampStripHalfLength(rawHalfLength: number): number {
  return Math.max(rawHalfLength, MIN_STRIP_HALF_LENGTH)
}

function clampStripWidth(rawWidth: number): number {
  return Math.max(rawWidth, MIN_STRIP_WIDTH_PX)
}

// Threshold markings: a series of parallel white stripes at each strip's
// threshold end, LONGITUDINAL - each stripe is a long thin bar running
// PARALLEL to the runway's own length axis (the direction of travel),
// laid side-by-side across the strip's width - matching real-world
// threshold marking convention. (First pass had these perpendicular to
// the length, like ladder rungs - backwards; corrected here to run
// along the length instead, with multiple bars spanning the width.)
// 5 stripes with a 1:1 stripe:gap ratio reads as a clean, evenly-spaced
// bar set at any strip width, since each stripe's thickness is now
// derived from the strip's own width - proportional by construction.
const THRESHOLD_STRIPE_COUNT = 5

// Fixed length (along the strip's own axis) of the whole marking block at
// each end - independent of strip width AND of wherever the identifier
// numeral currently sits. Previously this block's rendered size was tied
// to the numeral's inset, so pushing the numeral out to clear the block
// made the block itself grow to match - a feedback loop that visibly
// bloated the grid. Keeping it fixed and moving only the numeral fixes
// that. Unchanged by the checkerboard -> stripe swap - same block, same
// footprint (now each stripe's own LENGTH, not its thickness), just a
// different fill pattern inside it.
const THRESHOLD_MARKING_BLOCK_LENGTH = 20

// Visible clearance between the marking block's inner edge and the
// identifier numeral, when that strip's markings are on. Was 8 - too
// tight once the stripes became solid white rects (vs. the old
// checkerboard's lighter texture), so the numeral's own glyph height
// routinely overlapped the block instead of clearing it. More than
// doubled so the gap comfortably outlasts a typical digit's rendered
// height at the font sizes actually in use (14-20px), not just its
// anchor point.
const THRESHOLD_MARKING_LABEL_GAP = 18

// Identifier numeral inset from each strip end - unchanged "previous
// position" when that strip's threshold markings are off.
const NUMBER_INSET_DEFAULT = 20
const NUMBER_INSET_WITH_MARKINGS = THRESHOLD_MARKING_BLOCK_LENGTH + THRESHOLD_MARKING_LABEL_GAP

// One end's set of longitudinal stripes - each spans the FULL block
// length in one rect (no more stacking rows within the block, since a
// stripe's long axis is now the strip's length, not its width), sized
// N stripes + N equal gaps across the strip's own width so each stripe
// is exactly as thick as the gap beside it (a clean 1:1 bar/space
// rhythm), proportional to stripWidth by construction. blockY is the
// block's own top edge - stripTop for the near end, stripBottom minus
// the block length for the far end. shapeRendering="crispEdges" keeps
// bar edges sharp.
function ThresholdStripeSet({
  stripX,
  stripWidth,
  blockY,
}: {
  stripX: number
  stripWidth: number
  blockY: number
}): JSX.Element {
  const thickness = stripWidth / (THRESHOLD_STRIPE_COUNT * 2)
  const step = thickness * 2
  return (
    <>
      {Array.from({ length: THRESHOLD_STRIPE_COUNT }, (_, i) => (
        <rect
          key={i}
          x={stripX + i * step}
          y={blockY}
          width={thickness}
          height={THRESHOLD_MARKING_BLOCK_LENGTH}
          fill="white"
          shapeRendering="crispEdges"
        />
      ))}
    </>
  )
}

// Both ends of a single physical strip's threshold marking - twin groups
// call this once per strip, not once per group, and only for strips that
// have their own markings toggled on.
function ThresholdMarkingBlocks({
  stripX,
  stripWidth,
  stripTop,
  stripBottom,
}: {
  stripX: number
  stripWidth: number
  stripTop: number
  stripBottom: number
}): JSX.Element {
  return (
    <>
      <ThresholdStripeSet stripX={stripX} stripWidth={stripWidth} blockY={stripTop} />
      <ThresholdStripeSet stripX={stripX} stripWidth={stripWidth} blockY={stripBottom - THRESHOLD_MARKING_BLOCK_LENGTH} />
    </>
  )
}

// Threshold light bars round: a slim always-on bar at each end of every
// strip, one per strip (not per group - matching ThresholdMarkingBlocks'
// own per-strip convention just above, so a twin group's tarmac+grass
// strips each get their own pair, not one shared pair). Repositioned
// (outer-edge round) from "just inside the checkerboard block" to just
// OUTSIDE the strip's own rect entirely - THRESHOLD_LIGHT_GAP_PX beyond
// stripTop/stripBottom, the strip's own true physical ends - rather than
// overlapping the checkerboard/stripe block's own [stripTop,
// stripTop+THRESHOLD_MARKING_BLOCK_LENGTH] span (which starts exactly AT
// the strip's edge, leaving no free room inside it). The gap keeps a
// clean, non-touching margin from the strip's own top/bottom edge lines
// (stroke width 2, centred on stripTop/stripBottom) too - real threshold
// lights sit beyond the painted markings, not on top of them. Rendered
// unconditionally, independent of that strip's own hasThresholdMarkings
// toggle, since this is a distinct feature ("every runway strip"), not
// an extension of the optional marking. Colour is plain green/red on
// whichever end matches activeRunwayEnd, same isTopActive/isBottomActive
// boolean the identifier highlight above already computes from the same
// raw string - no separate lookup, so this can never disagree with that
// highlight.
const THRESHOLD_LIGHT_HEIGHT = 5
const THRESHOLD_LIGHT_GAP_PX = 2
// Same two tokens the identifier highlight (RunwayIdentifierText) and
// this file's own arrow-green/arrow-red wind-arrow classes already use -
// not a new hardcoded green/red pair.
const THRESHOLD_LIGHT_ACTIVE_FILL = 'var(--color-status-good-text)'
const THRESHOLD_LIGHT_INACTIVE_FILL = 'var(--color-status-bad-text)'

function ThresholdLightBars({
  stripX,
  stripWidth,
  stripTop,
  stripBottom,
  topActive,
  bottomActive,
}: {
  stripX: number
  stripWidth: number
  stripTop: number
  stripBottom: number
  topActive: boolean
  bottomActive: boolean
}): JSX.Element {
  return (
    <>
      <rect
        x={stripX}
        y={stripTop - THRESHOLD_LIGHT_GAP_PX - THRESHOLD_LIGHT_HEIGHT}
        width={stripWidth}
        height={THRESHOLD_LIGHT_HEIGHT}
        fill={topActive ? THRESHOLD_LIGHT_ACTIVE_FILL : THRESHOLD_LIGHT_INACTIVE_FILL}
      />
      <rect
        x={stripX}
        y={stripBottom + THRESHOLD_LIGHT_GAP_PX}
        width={stripWidth}
        height={THRESHOLD_LIGHT_HEIGHT}
        fill={bottomActive ? THRESHOLD_LIGHT_ACTIVE_FILL : THRESHOLD_LIGHT_INACTIVE_FILL}
      />
    </>
  )
}

// Per-strip numeral inset: when that strip's own markings are on, its
// numerals move clear of the fixed-length checkerboard block instead of
// sitting at the block's inner edge; markings off keeps the "previous"
// position - independent of any other strip in the same group.
function numberInsetFor(strip: RunwayStrip | undefined): number {
  return strip?.hasThresholdMarkings ? NUMBER_INSET_WITH_MARKINGS : NUMBER_INSET_DEFAULT
}

// Real-world runway signage convention: the numeral at each end is
// oriented for someone approaching FROM that end, so the two ends read
// 180° apart from each other, not both facing the same way. Whichever
// numeral gets rotate180 here has an EXTRA local 180° spin added around
// its own (x, y) on top of the group's rotate(headingDegrees) transform -
// it stays in exactly the same screen position, just flipped in place.
// Callers decide which of the pair (labelTop/labelBottom) carries the
// extra spin - see the per-block usage below.
// active (main dashboard round): highlights whichever identifier
// matches opsPanel.activeRunwayEnd - a plain string match against the
// SAME raw value the headwind/crosswind maths already key off (see
// RunwayGroupGraphic's own isTopActive/isBottomActive below), not
// derived from headingDegrees/activeRunwayHeading/reverseCompassNeedle
// at all. Before this, the strip graphic gave both ends an identical
// look, so the only way a viewer could infer "which end is active" was
// the wind arrow's rotational position relative to the fixed strip -
// which, for a tenant with reverseCompassNeedle set, can visually align
// near the INACTIVE end's identifier for an ordinary tailwind reading
// (confirmed against Shobdon's own real production data: 270°/4kt with
// activeRunwayEnd="08" put the arrow right beside the "26" label even
// though the headwind/crosswind readout - correctly - showed a 08
// tailwind). Matching directly on the same string the numbers use makes
// the two impossible to disagree, regardless of any heading/rotation
// quirk on either side. Colour round: --color-status-good-text (this
// file's own themeable-fill convention, matching the background circle's
// fill="var(--color-compass-disc-bg)" a few lines below) - the same
// token WeatherStatusIndicator.tsx now uses for its own "LIVE ATC" text
// and RunwayWindWidget.tsx/this file's own arrow already use for their
// "good" wind state, not a second hardcoded copy of a colour picked
// independently.
// Outline round: replaces the earlier dark-pill badge behind each
// identifier (removed - collided visually with the badge's own
// admin-unbounded strip/font sizing more than it helped legibility) with
// a plain stroke-only outline on the text itself - fill="none", a 1px
// stroke, same active(green)/inactive(white) colour split as before,
// just carried by strokeWidth/stroke rather than a filled glyph. Still a
// flat +2px display-only bump over the admin-configured
// identifierFontSizePx - RunwaysPage.tsx's own stored value stays
// untouched, only what's actually rendered here is larger.
const IDENTIFIER_FONT_SIZE_BOOST_PX = 2
const IDENTIFIER_OUTLINE_STROKE_WIDTH = 1

function RunwayIdentifierText({
  x,
  y,
  text,
  fontSize,
  rotate180,
  active,
}: {
  x: number
  y: number
  text: string
  fontSize: number
  rotate180?: boolean
  active?: boolean
}): JSX.Element {
  const renderedFontSize = fontSize + IDENTIFIER_FONT_SIZE_BOOST_PX
  const content = (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      className="select-none"
      fill="none"
      stroke={active ? 'var(--color-status-good-text)' : 'white'}
      strokeWidth={IDENTIFIER_OUTLINE_STROKE_WIDTH}
      fontSize={renderedFontSize}
      fontWeight="900"
      opacity={active ? 1 : 0.85}
    >
      {text}
    </text>
  )
  return rotate180 ? <g transform={`rotate(180 ${x} ${y})`}>{content}</g> : content
}

// enabled/showCenterline !== false rather than === true so a missing/
// undefined field (shouldn't happen post-migration, but defensive
// against any stale/unexpected data) defaults to shown - matching the
// migration's own per-strip default.
function showsCenterline(strip: RunwayStrip | undefined): boolean {
  return strip?.showCenterline !== false
}

function RunwayGroupGraphic({ group, activeEnd }: { group: RunwayGroup; activeEnd: string }): JSX.Element {
  // endAIdentifier is always the end at compass bearing = headingDegrees
  // (previously "labelTop" - the physical position, not the string, is
  // what determines which end this is); endBIdentifier is the reciprocal
  // end (previously "labelBottom"). Kept the labelTop/labelBottom names
  // below since every position variable in this function (stripTop,
  // NumberTopY, etc.) already means "the physical top before rotation" -
  // renaming just these two would make the position pairing less obvious,
  // not more.
  const labelTop = group.endAIdentifier
  const labelBottom = group.endBIdentifier
  // '' (not yet loaded) matches neither, so nothing is highlighted until
  // real data arrives - same "no data yet" posture as compassState's own
  // hasActiveRunwayData, rather than guessing labelTop is active by
  // default the way the headwind/crosswind fallback below does (that
  // fallback exists to keep the maths defined even with no data; a
  // highlight has no equivalent need to ever show something).
  const isTopActive = activeEnd !== '' && activeEnd === labelTop
  const isBottomActive = activeEnd !== '' && activeEnd === labelBottom
  const halfLength = clampStripHalfLength(group.stripLengthPx / 2)
  const stripTop = 200 - halfLength
  const stripBottom = 200 + halfLength
  const stripHeight = halfLength * 2
  // Was stripTop - 10 / stripBottom + 10 - a deliberate 10px overshoot
  // past each end cap that went unnoticed while the centreline was
  // nearly invisible (opacity 0.18); now that it's bright white and
  // fully opaque, the overshoot showed up as dash fragments poking out
  // past the strip's own boundary. Constrained to the strip's actual
  // rendered length - starts and ends exactly at its own edges.
  const centrelineTop = stripTop
  const centrelineBottom = stripBottom
  const fontSize = group.identifierFontSizePx

  // Shobdon's own runway group used to be special-cased here (a
  // hardcoded tarmac-centre-at-x=214 anchor, "pixel-identical to the
  // original hand-tuned seeded values"), removed after confirming
  // directly against production data that it was actively wrong: it was
  // only ever centred correctly at the original seeded default widths
  // (22px/22px); Shobdon's real strips have since been edited to 46px/
  // 46px, and the fixed 214 anchor left the true pivot (200,200) sitting
  // inside the tarmac strip's own span instead of the gap between the
  // two strips. The general twin-group formula below anchors the GAP
  // itself symmetrically around 200 instead of either individual strip,
  // so it's correct for any width combination automatically - Shobdon's
  // own group already has twin=true in D1, so it falls through to this
  // branch with no data changes needed. (RunwayStripPreview.tsx's /runways
  // live-preview component has its own separate copy of the same old
  // bug, independent of this file - not touched here, flagged
  // separately.)
  if (group.twin) {
    const [stripA, stripB] = group.strips
    const stripAWidth = clampStripWidth(stripA?.widthPx ?? 22)
    const stripBWidth = clampStripWidth(stripB?.widthPx ?? 22)
    // Gap is centred on the group's own axis (200); each strip then
    // extends outward from its own edge of that gap by its own width -
    // independent widths, but the physical gap between them stays exactly
    // RUNWAY_STRIP_GAP regardless of what either width is.
    const stripBX = 200 + RUNWAY_STRIP_GAP / 2
    const stripAX = 200 - RUNWAY_STRIP_GAP / 2 - stripAWidth
    const leftEdge = stripAX
    const rightEdge = stripBX + stripBWidth
    const stripACentreX = stripAX + stripAWidth / 2
    const stripBCentreX = stripBX + stripBWidth / 2
    const stripAInset = numberInsetFor(stripA)
    const stripBInset = numberInsetFor(stripB)
    const stripANumberTopY = stripTop + stripAInset
    const stripANumberBottomY = stripBottom - stripAInset
    const stripBNumberTopY = stripTop + stripBInset
    const stripBNumberBottomY = stripBottom - stripBInset
    return (
      <g transform={`rotate(${group.headingDegrees} 200 200)`}>
        <rect x={stripAX} y={stripTop} width={stripAWidth} height={stripHeight} fill={stripA?.colour ?? '#4caf50'} opacity="0.65" />
        <rect x={stripBX} y={stripTop} width={stripBWidth} height={stripHeight} fill={stripB?.colour ?? '#a8b4c4'} opacity="0.5" />
        {stripA?.hasThresholdMarkings && (
          <ThresholdMarkingBlocks stripX={stripAX} stripWidth={stripAWidth} stripTop={stripTop} stripBottom={stripBottom} />
        )}
        {stripB?.hasThresholdMarkings && (
          <ThresholdMarkingBlocks stripX={stripBX} stripWidth={stripBWidth} stripTop={stripTop} stripBottom={stripBottom} />
        )}
        <ThresholdLightBars stripX={stripAX} stripWidth={stripAWidth} stripTop={stripTop} stripBottom={stripBottom} topActive={isTopActive} bottomActive={isBottomActive} />
        <ThresholdLightBars stripX={stripBX} stripWidth={stripBWidth} stripTop={stripTop} stripBottom={stripBottom} topActive={isTopActive} bottomActive={isBottomActive} />
        {showsCenterline(stripA) && (
          <line x1={stripACentreX} y1={centrelineTop} x2={stripACentreX} y2={centrelineBottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />
        )}
        {showsCenterline(stripB) && (
          <line x1={stripBCentreX} y1={centrelineTop} x2={stripBCentreX} y2={centrelineBottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />
        )}
        <line x1={leftEdge} y1={stripTop} x2={rightEdge} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
        <line x1={leftEdge} y1={stripBottom} x2={rightEdge} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
        {stripA?.showIdentifierLabel && (
          <>
            <RunwayIdentifierText x={stripACentreX} y={stripANumberTopY} text={labelTop} fontSize={fontSize} rotate180 active={isTopActive} />
            <RunwayIdentifierText x={stripACentreX} y={stripANumberBottomY} text={labelBottom} fontSize={fontSize} active={isBottomActive} />
          </>
        )}
        {stripB?.showIdentifierLabel && (
          <>
            <RunwayIdentifierText x={stripBCentreX} y={stripBNumberTopY} text={labelTop} fontSize={fontSize} rotate180 active={isTopActive} />
            <RunwayIdentifierText x={stripBCentreX} y={stripBNumberBottomY} text={labelBottom} fontSize={fontSize} active={isBottomActive} />
          </>
        )}
      </g>
    )
  }

  // Not twin: one strip, its own width used directly - no more doubling
  // trick, since width no longer comes from a shared group-level value.
  const [strip] = group.strips
  const width = clampStripWidth(strip?.widthPx ?? 44)
  const stripX = 200 - width / 2
  const edge = stripX + width
  const inset = numberInsetFor(strip)
  const numberTopY = stripTop + inset
  const numberBottomY = stripBottom - inset
  return (
    <g transform={`rotate(${group.headingDegrees} 200 200)`}>
      <rect x={stripX} y={stripTop} width={width} height={stripHeight} fill={strip?.colour ?? '#a8b4c4'} opacity="0.5" />
      {strip?.hasThresholdMarkings && (
        <ThresholdMarkingBlocks stripX={stripX} stripWidth={width} stripTop={stripTop} stripBottom={stripBottom} />
      )}
      <ThresholdLightBars stripX={stripX} stripWidth={width} stripTop={stripTop} stripBottom={stripBottom} topActive={isTopActive} bottomActive={isBottomActive} />
      {showsCenterline(strip) && (
        <line x1="200" y1={centrelineTop} x2="200" y2={centrelineBottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />
      )}
      <line x1={stripX} y1={stripTop} x2={edge} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
      <line x1={stripX} y1={stripBottom} x2={edge} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
      {strip?.showIdentifierLabel && (
        <>
          <RunwayIdentifierText x={200} y={numberTopY} text={labelTop} fontSize={fontSize} rotate180 active={isTopActive} />
          <RunwayIdentifierText x={200} y={numberBottomY} text={labelBottom} fontSize={fontSize} active={isBottomActive} />
        </>
      )}
    </g>
  )
}

// Wind arrow tail feathers (fletching) - three chevron ticks near the
// tail end (opposite the arrowhead, which points toward y=32; the
// shaft's blunt tail cap sits at y=368). Each chevron's vertex (the
// attachment point on the shaft) sits up the shaft toward the head, with
// its two arms flaring outward and further down toward the tail - same
// visual logic as real arrow fletching. The nearest arm tip (last
// feather) lands 30px shy of the tail cap (368 - 30 = 338), not
// touching it. These vertex positions are relative to the tail cap, so
// when the needle's overall length changes (see the two polygons above),
// these must shift by the same amount or the feathers end up stranded
// mid-shaft instead of at the tail - shifted +10 here to track the tail
// cap's own +10 extension (358 -> 368). Static geometry inside the same
// rotating <g id="wind-arrow"> group the needle itself lives in, so it
// rotates identically with no separate transform needed.
const TAIL_FEATHER_VERTEX_YS = [298, 318, 338]
const TAIL_FEATHER_ARM_DY = 18
const TAIL_FEATHER_ARM_DX = 16

function tailFeatherPoints(vertexY: number): string {
  const armY = vertexY + TAIL_FEATHER_ARM_DY
  return `${200 - TAIL_FEATHER_ARM_DX},${armY} 200,${vertexY} ${200 + TAIL_FEATHER_ARM_DX},${armY}`
}

interface ReadoutRowProps {
  label: string
  value: string
  valueClassName?: string
  labelFontSizeOverride?: string
}

// Sized off vh directly, not rem (which would inherit the global root
// clamp() in index.css) - that global scale is driven by vmin, which
// tracks viewport WIDTH on a narrow/tall screen just as much as height,
// but this list's actual available room comes purely from how tall its
// flex row is, itself ultimately a fraction of viewport HEIGHT. On most
// 16:9-ish screens the two track closely enough that it never showed up,
// but on a short-height screen the global floor (12px, tuned for
// LeftInfoPanel's stat cards, a separate list with different row count/
// spacing) can stay above what 7 rows actually fit into here - confirmed
// by direct measurement: at a short enough viewport, the compass row's
// real height budget shrinks faster than the vmin-floored global font
// does, so the last readout row ran off the bottom. vh ties this list's
// size directly to the axis it actually competes for, independent of the
// media-panel/compass flex ratio (that ratio only sets the compass
// INSTRUMENT's own h-full box - the readout is a separate flex sibling).
// Ceiling matches this list's original tuned size exactly (28px/16px at
// 1080p, where this was designed and is unchanged today), so nothing
// shifts at the reference resolution - only the floor is materially
// different, giving this dense 7-row list more room to shrink than the
// shared global floor allows before it would start clipping.
const READOUT_VALUE_FONT = 'clamp(9px, 2.6vh, 28px)'
const READOUT_LABEL_FONT = 'clamp(7px, 1.5vh, 16px)'

// Pilot View's own opt-in ("spacious" prop below) - a fixed size, not a
// vh-clamp(), matching every other Pilot View file's own plain-Tailwind-
// size convention (see WeatherStatGrid.tsx's own comment on why: this
// page's actual height budget is the whole scrolling document, not a
// fixed kiosk viewport, so vh doesn't track "how much room is there" the
// way it deliberately does for the TV dashboard's fixed-height row above).
// Every existing TV-dashboard caller omits `spacious` and keeps the
// original vh-based READOUT_LABEL_FONT untouched.
const PILOT_READOUT_LABEL_FONT = '14px'

function ReadoutRow({ label, value, valueClassName = 'text-white', labelFontSizeOverride }: ReadoutRowProps): JSX.Element {
  return (
    <>
      <div
        className="text-right font-semibold uppercase leading-none tracking-widest text-slate-400"
        style={{ fontSize: labelFontSizeOverride ?? READOUT_LABEL_FONT }}
      >
        {label}
      </div>
      <div className={`font-extrabold leading-none ${valueClassName}`} style={{ fontSize: READOUT_VALUE_FONT }}>
        {value}
      </div>
    </>
  )
}

interface CompassPanelProps {
  // Pilot View passes this true - its readout list sits directly below
  // the compass with nothing beside it (see the sm:-gated left offset
  // comment above), and felt cramped against the compass at the default
  // TV-dashboard spacing/label size. Defaults false: every existing TV-
  // dashboard caller (ClassicTemplate/Clubhouse2Template/CentreDisplayPanel)
  // omits this prop and renders exactly as before.
  spacious?: boolean
  // Pilot View round: the runway/windsock widget (RunwayWindWidget.tsx,
  // via PilotRunwayWindPanel.tsx) now sits directly below the compass on
  // that route instead of this readout list - Headwind/Crosswind/Trend
  // live inside that widget instead, and Wind is already shown in the
  // compass's own centre label (the rotating "280 / 7" pill), so the
  // whole list is redundant there rather than needing a trimmed
  // replacement. Defaults false: every existing caller (every TV-
  // dashboard template, and Pilot View itself before this round) omits
  // this and keeps the readout exactly as before - the compass
  // INSTRUMENT (rose + wind arrow + centre label) is never affected by
  // this prop, only the separate list below/beside it.
  hideReadout?: boolean
}

export default function CompassPanel({ spacious = false, hideReadout = false }: CompassPanelProps = {}): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  // Was a synchronous loadClubProfile() (localStorage) read - now an
  // async fetch of the tenant-scoped public config endpoint, so
  // runwayGroups starts empty for one render until it resolves (matches
  // the same brief-loading-flash characteristic DashboardPage.tsx's
  // theme fetch has always had). No auth here deliberately - this is
  // the live public dashboard, which must keep working with zero login,
  // same as every device viewing it today (PC2, clubhouse display,
  // anyone with the link).
  // reverseCompassNeedle: developer-only safety-net override (see
  // /developertools) meaning this tenant's own stored heading data is
  // known to be backwards for its physical station - genuinely required
  // for a correct headwind/tailwind/crosswind result, not cosmetic-only.
  // Applied in TWO places, both required: directly to the arrow's own
  // rotation below (compassState.windDirection is never itself modified),
  // AND separately, before this, to activeRunwayHeading below (which
  // headwind/crosswind ARE computed from) - see that value's own comment.
  // An earlier version of this comment claimed it only affected the
  // arrow's rotation; RunwayWindWidget.tsx's own comment documents the
  // real incident that disproved that (Shobdon production data produced
  // an inverted Headwind/Tailwind result there before both corrections
  // were applied consistently).
  const [clubProfile, setClubProfile] = useState<{
    runwayGroups: RunwayGroup[]
    reverseCompassNeedle: boolean
    activeRunwayEnd: string
    // Tenant-configurable (migration 0081), developer-editable only via
    // direct D1 update - see windCalculations.ts's own comment. Defaults
    // to DEFAULT_ARROW_THRESHOLDS until the fetch below resolves, same
    // "never a broken/undefined read" posture every other clubProfile
    // field here already takes.
    arrowThresholds: ArrowColourThresholds
  }>({
    runwayGroups: [],
    reverseCompassNeedle: false,
    activeRunwayEnd: '',
    arrowThresholds: DEFAULT_ARROW_THRESHOLDS,
  })

  // Raw stored/selected preference, not necessarily what's actually
  // applied right now - see effectiveCompassMode below, which is the one
  // that actually drives rendering. Keeping these separate means a
  // pilot who taps RUNWAY before ATC has set an active runway yet still
  // has that intent remembered - the moment activeRunwayEnd becomes
  // non-empty (ATC sets it, or a fresh fetch resolves), the dial starts
  // rotating automatically with no need to tap the button again.
  const [compassMode, setCompassMode] = useState<CompassMode>(loadStoredCompassMode)

  function handleCompassModeChange(next: CompassMode) {
    setCompassMode(next)
    try {
      window.localStorage.setItem(COMPASS_MODE_STORAGE_KEY, next)
    } catch {
      // Private browsing / storage disabled - the toggle still works for
      // this session, it just won't be remembered on the next visit.
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.runwayGroups) {
          setClubProfile({
            runwayGroups: data.runwayGroups,
            reverseCompassNeedle: !!data?.opsPanel?.reverseCompassNeedle,
            activeRunwayEnd: data?.opsPanel?.activeRunwayEnd ?? '',
            arrowThresholds: {
              tailwindKt: data?.arrowThresholds?.tailwindKt ?? DEFAULT_ARROW_THRESHOLDS.tailwindKt,
              crosswindKt: data?.arrowThresholds?.crosswindKt ?? DEFAULT_ARROW_THRESHOLDS.crosswindKt,
              headwindKt: data?.arrowThresholds?.headwindKt ?? DEFAULT_ARROW_THRESHOLDS.headwindKt,
            },
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const compassState = useMemo<CompassState | null>(() => {
    if (!weather || clubProfile.runwayGroups.length === 0) return null

    // headingDegrees on a RunwayGroup is only ever the endAIdentifier
    // end's heading (see types/clubProfile.ts) - endB is always its
    // reciprocal (+180), never stored separately. This was previously
    // read unconditionally as "the" runway heading with no regard for
    // which end ATC Control has actually marked active - correct only
    // when endA happens to be in use, and silently 180° wrong (a
    // headwind/tailwind sign inversion, correct-looking crosswind)
    // every time endB is active instead. Match against endBIdentifier
    // specifically (not "!== endAIdentifier") so an empty/not-yet-loaded
    // activeRunwayEnd falls back to endA, the same value this always
    // used before this fix.
    const activeGroup = clubProfile.runwayGroups[0]
    const resolvedRunwayHeading =
      clubProfile.activeRunwayEnd === activeGroup.endBIdentifier
        ? (activeGroup.headingDegrees + 180) % 360
        : activeGroup.headingDegrees
    // reverseCompassNeedle (this tenant's own flag, or inherited from a
    // parent - see publicConfig.ts's opsPanel splice) means the stored
    // heading data itself is known to be backwards for this physical
    // station, not just a cosmetic arrow-rotation preference. Applying
    // the same 180° correction here, before the wind-component maths,
    // means headwind/tailwind/crosswind stay consistent with the
    // corrected visual strip/arrow by construction - one flip, not two
    // separately-maintained ones that could drift out of sync. Applied
    // after endA/endB resolution above, so it stays correct for
    // whichever end is actually active, not hardcoded to one end.
    const activeRunwayHeading = clubProfile.reverseCompassNeedle
      ? (resolvedRunwayHeading + 180) % 360
      : resolvedRunwayHeading
    const { headwind, crosswind } = calculateWindComponents(
      weather.windSpeed,
      weather.windDirection,
      activeRunwayHeading
    )
    const arrowColour = determineArrowColour(headwind, crosswind, clubProfile.arrowThresholds)

    return {
      windSpeed: weather.windSpeed,
      windDirection: weather.windDirection,
      pressureTrend: weather.pressureTrend,
      headwind,
      crosswind,
      arrowColour,
      activeRunwayHeading,
    }
  }, [weather, clubProfile])

  const trendSymbol = useMemo(() => {
    switch (compassState?.pressureTrend) {
      case 'rising':
        return '↗'
      case 'falling':
        return '↘'
      default:
        return '→'
    }
  }, [compassState])

  const trendLabel = useMemo(() => {
    switch (compassState?.pressureTrend) {
      case 'rising':
        return 'Rising'
      case 'falling':
        return 'Falling'
      default:
        return 'Steady'
    }
  }, [compassState])

  const trendColour = useMemo(() => {
    switch (compassState?.pressureTrend) {
      case 'rising':
        return 'text-green-500'
      case 'falling':
        return 'text-red-500'
      default:
        return 'text-slate-500'
    }
  }, [compassState])

  const crosswindColour = useMemo(() => {
    return Math.abs(compassState?.crosswind ?? 0) > 5 ? 'text-amber-500' : 'text-slate-300'
  }, [compassState])

  const headwindColour = useMemo(() => {
    return (compassState?.headwind ?? 0) > 0 ? 'text-green-500' : 'text-red-500'
  }, [compassState])

  // Aviation terminology never says "negative headwind" - a negative
  // component IS a tailwind, so the label itself flips rather than the
  // readout showing a signed number under a fixed "Headwind" label.
  // Rounded to the same 1-decimal precision as the displayed value
  // before comparing against zero, so a near-perpendicular wind
  // (headwind component genuinely ~0) can't flicker between the two
  // labels from floating-point noise alone (e.g. -0.04 rounding to
  // display "0.0" while still separately testing as negative).
  const headwindRounded = useMemo(() => Math.round((compassState?.headwind ?? 0) * 10) / 10, [compassState])
  const headwindLabel = headwindRounded < 0 ? 'Tailwind' : 'Headwind'
  const headwindMagnitude = Math.abs(headwindRounded)

  const arrowColourClass = useMemo(() => {
    switch (compassState?.arrowColour) {
      case 'green':
        return 'arrow-green'
      case 'amber':
        return 'arrow-amber'
      case 'red':
        return 'arrow-red'
      default:
        return 'arrow-green'
    }
  }, [compassState])

  if (!compassState) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        Loading weather…
      </div>
    )
  }

  // '' matches this file's own existing fallback-to-endA convention
  // elsewhere (the headwind/crosswind maths above never treats an unset
  // activeRunwayEnd as an error) - but for THIS feature specifically, an
  // explicitly-unset active runway should read as "no data" rather than
  // silently pointing RUNWAY mode at whatever endA happens to be, since
  // that would present an unconfirmed runway as if it were confirmed.
  const hasActiveRunwayData = clubProfile.activeRunwayEnd !== ''
  // What's actually applied right now, not necessarily the raw stored
  // preference above - falls back to NORTH whenever RUNWAY is selected
  // but there's no data to rotate toward, matching requirement 3 exactly
  // ("keep the compass in NORTH mode - don't switch/rotate anything").
  const effectiveCompassMode: CompassMode = compassMode === 'runway' && hasActiveRunwayData ? 'runway' : 'north'
  const showNoRunwayNotice = compassMode === 'runway' && !hasActiveRunwayData
  // Brings activeRunwayHeading to the TOP of the dial: SVG rotate() and
  // compass bearings both increase clockwise in this file's existing
  // convention (see RunwayGroupGraphic's own rotate(headingDegrees) a
  // few hundred lines up), so undoing a bearing's clockwise offset from
  // 0/top needs the NEGATIVE of that bearing.
  const dialRotationDegrees = effectiveCompassMode === 'runway' ? -compassState.activeRunwayHeading : 0

  return (
    <div className={`flex h-full flex-col items-center justify-center ${spacious ? 'gap-8' : 'gap-4'} pt-6 sm:flex-row sm:gap-7`}>
      {/* NORTH/RUNWAY mode toggle - spacious-gated (Pilot View only, per
          the existing convention every other prop on this component
          already uses to distinguish it from the unattended TV/kiosk
          dashboard callers). An interactive per-pilot preference toggle
          has no meaning on a shared public display nobody is standing at
          tapping buttons, so every non-spacious caller renders exactly
          as it always has, completely unaffected.

          Sized/positioned round: buttons sit at the compass circle's own
          left/right "shoulders" instead of centred as a pair, with a
          small deliberate gap between each button's bottom edge and the
          circle's own top edge (not flush - an earlier flush-fit pass
          read as visually touching/overlapping the ring, corrected after
          review). Deliberately kept in normal flex flow (not
          position:absolute) - an absolutely positioned overlay would
          stop reserving its own vertical space, pulling the instrument
          up to visually collide with whatever sits above it on /pilot
          (the Crosswind/Headwind readout row) - staying in-flow avoids
          that entirely. w-full + no horizontal inset matches the
          instrument's own w-full below (both direct children of the
          same flex-col parent) exactly, so justify-between's two ends
          land flush with the instrument's true left/right edges - the
          closest either button can get to the circle's own edges
          without overflowing past the page's own content width. That's
          also the tightest fit available: even after two size-reduction
          passes (most recently another ~10% off padding/font-size, on
          top of the original ~60%-larger build), flush-with-edges was
          kept rather than reintroduced as an inset, so the horizontal
          gap stays the largest the page's own width allows rather than
          shrinking further for no reason (currently ~122px on a real
          iPhone-width viewport, up from ~58-77px before this pass's
          size reduction - the buttons got smaller, the instrument's own
          width didn't, so the gap between them grew on its own).
          mb-[-33px]/mb-[-29px] cancels this row out of the parent's own
          gap-8/gap-7 (tuned for spacing BETWEEN page sections, not
          snugness against the circle immediately below this one) AND
          most (but deliberately not all) of the extra ~19px the circle
          itself sits inset within its own square SVG viewBox
          (RING_RADIUS=180 inside a 400-tall viewBox, i.e. a fixed 5%
          margin before the circle's true top edge) - gap and margin are
          independently additive in flexbox, so this negative margin
          subtracts cleanly from just this one gap without affecting
          spacing between any other siblings. Confirmed ~9px vertical
          gap between button-bottom and the circle's true top edge via
          direct bounding-box measurement, not just visually - unchanged
          by this pass's further size reduction, since a smaller button
          simply leaves more of the existing negative margin's headroom
          as visible gap rather than needing its own retuning. Active vs
          inactive is shown by text colour alone (white vs slate-400),
          not a background fill - both states share the same transparent
          background and border, a deliberate revision from an earlier
          solid-blue-fill active state that read as too heavy at this
          smaller button size. All values here tuned against real
          /pilot renders at multiple widths, not derived from a single
          formula. */}
      {spacious && (
        <div className="flex w-full flex-shrink-0 flex-col items-center gap-2 mb-[-33px] sm:mb-[-29px] sm:w-auto">
          <div className="flex w-full items-center justify-between">
            <button
              type="button"
              onClick={() => handleCompassModeChange('north')}
              className={`rounded-xl border border-slate-700 px-[20px] py-[7px] text-[17px] font-bold uppercase tracking-widest transition ${
                effectiveCompassMode === 'north' ? 'text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              North
            </button>
            <button
              type="button"
              onClick={() => handleCompassModeChange('runway')}
              className={`rounded-xl border border-slate-700 px-[20px] py-[7px] text-[17px] font-bold uppercase tracking-widest transition ${
                effectiveCompassMode === 'runway' ? 'text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Runway
            </button>
          </div>
          {/* Requirement 3's fallback - derived, not a one-off toast: stays
              visible for as long as RUNWAY is the stored preference but
              activeRunwayEnd is unset, and disappears on its own the
              moment data becomes available (dial then starts rotating
              automatically too - see effectiveCompassMode above). */}
          {showNoRunwayNotice && <div className="text-xs font-semibold text-amber-400">No runway data available</div>}
        </div>
      )}

      {/* ── COMPASS INSTRUMENT ─────────────────────────────────────────
          Two overlapping SVGs sharing the same 400×400 viewBox.
          Layer 1 (bottom): static — compass rose and runway reference.
          Layer 2 (top):    live  — wind arrow only, always on top.
          Separate SVG elements guarantee the arrow can never merge
          with the runway regardless of wind/runway alignment.
          h-full + aspect-square (not a vh-based clamp()) - the instrument
          fills whatever height its flex row actually has, capped at
          max-w-full so it can never force this row wider than its own
          parent. Each SVG's own preserveAspectRatio="xMidYMid meet" then
          uniformly scales the fixed 400×400 content to fit that box with
          no distortion, exactly like CloudVisibilityChart's icons - so
          even if the box ends up non-square (width capped below height),
          the visible rose still renders as a true circle, just centred
          with empty margin on the constrained axis, never stretched.
          position:relative + left:-18px shifts ONLY this instrument left -
          unlike a negative margin, it doesn't drag the readout panel
          (the next flex sibling) along with it, since relative positioning
          doesn't affect where following siblings are laid out. Only
          meaningful in sm:flex-row mode, where the readout sits BESIDE
          the circle and this shift makes room for it visually - sm:-gated
          (not unconditional) since below `sm:` the readout stacks BELOW
          the circle instead (nothing beside it to make room for), and an
          unconditional shift there just pushes the whole instrument off
          true-center with nothing compensating for it (confirmed the
          hard way - this exact offset was reported as "compass slightly
          off-centre to the left" on the Pilot View mobile layout).

          Below `sm:` the parent switches to flex-col (circle stacked above
          the readout, not beside it) - h-full there would ask this item to
          claim its ENTIRE flex-column container's height as an unshrinkable
          (flex-shrink-0) flex-basis, leaving strictly zero room for the
          readout grid below regardless of how tall that container is (the
          claim is always exactly 100%, not "whatever's left over") - the
          readout would then overflow the container's bottom edge by its own
          full height, bleeding into whatever content follows in the page.
          Every existing caller (ClassicTemplate/Clubhouse2Template/
          CentreDisplayPanel) renders this on a fixed-width TV/kiosk canvas
          that's never actually narrower than `sm:`, so h-full's original
          row-mode behaviour there is completely unaffected by adding a
          width-driven variant below it - w-full+aspect-square derives a
          proportionate height FROM the (always-defined) column width
          instead, so the circle and readout both fit within whatever
          natural height the column ends up needing, no ancestor-supplied
          fixed height required. */}
      <div className="relative aspect-square max-w-full w-full flex-shrink-0 sm:left-[-18px] sm:h-full sm:w-auto">

          {/* LAYER 1 — Static reference: compass rose + runway */}
          <svg
            viewBox="0 0 400 400"
            className="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Background Circle - the one themeable fill in this file; everything
                else below stays on its existing literal colour, deliberately. */}
            <circle
              cx="200"
              cy="200"
              r={RING_RADIUS}
              fill="var(--color-compass-disc-bg)"
              stroke="rgba(59, 130, 246, 0.25)"
              strokeWidth="1.5"
            />

            {/* Rotating dial group (compass-mode round) - ONE transform
                here rotates the whole rose + runway reference together.
                RUNWAY mode brings the active runway heading to the top by
                rotating -activeRunwayHeading; NORTH mode
                (dialRotationDegrees === 0) renders byte-for-byte
                identical to what this markup always produced before this
                round - nothing changes visually until a pilot actually
                switches modes. runway-graphics is included deliberately,
                not just the rose - its own already-existing
                rotate(group.headingDegrees) then nets out to 0 in RUNWAY
                mode, so the strip points straight up on screen (a real
                track-up display), rather than the rose spinning around a
                strip left in its old fixed orientation. */}
            <g id="compass-dial" transform={`rotate(${dialRotationDegrees} 200 200)`} style={{ transition: 'transform 0.8s ease-in-out' }}>
              {/* COMPASS ROSE - Cardinal Points. Each letter gets its own
                  counter-rotation wrapper (rotate(-dialRotationDegrees)
                  around that letter's own x/y) - same established
                  per-element counter-rotation pattern
                  RunwayIdentifierText's rotate180 already uses elsewhere
                  in this file, just with a dynamic angle instead of a
                  fixed 180. The letter's POSITION still moves with the
                  dial (still a descendant of the rotating group above),
                  but this cancels the dial's rotation for the glyph's
                  OWN orientation, keeping it screen-upright. */}
              <g id="cardinal-points" className="pointer-events-none">
                <g transform={`rotate(${-dialRotationDegrees} ${NORTH_POINT.x} ${NORTH_POINT.y})`} style={{ transition: 'transform 0.8s ease-in-out' }}>
                  <text x={NORTH_POINT.x} y={NORTH_POINT.y} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">N</text>
                </g>
                <g transform={`rotate(${-dialRotationDegrees} ${EAST_POINT.x} ${EAST_POINT.y + CARDINAL_LETTER_VERTICAL_NUDGE})`} style={{ transition: 'transform 0.8s ease-in-out' }}>
                  <text x={EAST_POINT.x} y={EAST_POINT.y + CARDINAL_LETTER_VERTICAL_NUDGE} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">E</text>
                </g>
                <g transform={`rotate(${-dialRotationDegrees} ${SOUTH_POINT.x} ${SOUTH_POINT.y})`} style={{ transition: 'transform 0.8s ease-in-out' }}>
                  <text x={SOUTH_POINT.x} y={SOUTH_POINT.y} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">S</text>
                </g>
                <g transform={`rotate(${-dialRotationDegrees} ${WEST_POINT.x} ${WEST_POINT.y + CARDINAL_LETTER_VERTICAL_NUDGE})`} style={{ transition: 'transform 0.8s ease-in-out' }}>
                  <text x={WEST_POINT.x} y={WEST_POINT.y + CARDINAL_LETTER_VERTICAL_NUDGE} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">W</text>
                </g>
              </g>

              {/* Cardinal Direction Lines - no counter-rotation needed,
                  plain line segments have no inherent "upright"
                  orientation to preserve. */}
              <g id="cardinal-lines" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1.5">
                <line x1="200" y1="20" x2="200" y2="50" />
                <line x1="350" y1="200" x2="380" y2="200" />
                <line x1="200" y1="350" x2="200" y2="380" />
                <line x1="20" y1="200" x2="50" y2="200" />
              </g>

              {/* Intermediate Bearings - same per-label counter-rotation
                  as the cardinal letters above. */}
              <g id="intermediate-bearings" className="pointer-events-none">
                {INTERMEDIATE_BEARINGS.map((bearing) => {
                  const point = circlePoint(200, 200, INTERMEDIATE_LABEL_RADIUS, bearing.degrees)
                  return (
                    <g
                      key={`bearing-${bearing.degrees}`}
                      transform={`rotate(${-dialRotationDegrees} ${point.x} ${point.y})`}
                      style={{ transition: 'transform 0.8s ease-in-out' }}
                    >
                      <text
                        x={point.x}
                        y={point.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="select-none"
                        fill="rgba(148, 163, 184, 0.85)"
                        fontSize="18"
                        fontWeight="600"
                        letterSpacing="0.5"
                      >
                        {bearing.label}
                      </text>
                    </g>
                  )
                })}
              </g>

              {/* Degree Markers (every 30°) - no counter-rotation, same
                  reasoning as the cardinal lines above. */}
              <g id="degree-markers" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
                {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((degree) => {
                  const point = circlePoint(200, 200, TICK_MARK_OUTER_RADIUS, degree)
                  const innerPoint = circlePoint(200, 200, TICK_MARK_INNER_RADIUS, degree)
                  return (
                    <line
                      key={`marker-${degree}`}
                      x1={point.x}
                      y1={point.y}
                      x2={innerPoint.x}
                      y2={innerPoint.y}
                    />
                  )
                })}
              </g>

              {/* RUNWAY GRAPHIC(S) - background reference axis; never to
                  compete with the wind arrow. Included in this rotating
                  group deliberately - see the compass-dial comment
                  above. */}
              <g id="runway-graphics">
                {clubProfile.runwayGroups.map((group) => (
                  <RunwayGroupGraphic key={group.id} group={group} activeEnd={clubProfile.activeRunwayEnd} />
                ))}
              </g>
            </g>

            {/* Centre Point - outside the rotating group deliberately;
                it sits exactly on the rotation's own pivot, so rotating
                it would be a visual no-op either way. */}
            <circle cx="200" cy="200" r="4" fill="white" opacity="0.5" />
          </svg>

          {/* LAYER 2 — Wind arrow + annotation: always renders above Layer 1 */}
          <svg
            viewBox="0 0 400 400"
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Rotating wind arrow — long, thin needle; always on its own layer above the runway.
                reverseCompassNeedle (developer-only, /developertools) adds/removes 180° here ONLY -
                compassState.windDirection itself (used for the centre label, readout panel, and the
                headwind/crosswind maths above) is never touched by this flag.
                dialRotationDegrees (compass-mode round) is ALSO added here, not just on the dial's
                own group - this needle deliberately stays on its own separate SVG layer (see this
                component's own file-level comment on why: the arrow must never merge with the
                runway graphic), so it can't literally share a DOM parent with the rotating dial
                group above. Adding the same offset here achieves the identical visual result
                without that: rotations about the same centre point (200,200) compose by plain
                addition regardless of which element they're applied to, so this is mathematically
                identical to nesting the needle inside the dial's own rotated group. In NORTH mode
                dialRotationDegrees is always 0, so this is byte-for-byte the original formula. */}
            <g
              id="wind-arrow"
              className={`wind-arrow ${arrowColourClass}`}
              transform={`rotate(${compassState.windDirection + (clubProfile.reverseCompassNeedle ? 180 : 0) + dialRotationDegrees} 200 200)`}
              style={{ transition: 'transform 0.8s ease-in-out' }}
            >
              {/* Dark halo - keeps the needle legible over both runway strips */}
              <polygon points="200,27 213,80 207,80 207,372 193,372 193,80 187,80" fill="rgba(3, 7, 18, 0.85)" />
              {/* Full-length instrument needle: arrowhead + shaft through the centre to a plain tail, ~88% radius each way */}
              <polygon points="200,32 208,84 202,84 202,368 198,368 198,84 192,84" className="arrow-head fill-current" />
              {/* Tail feathers (fletching) - dark halo strokes first for legibility, then the colour-matched foreground ticks on top, same layering as the needle itself. */}
              {TAIL_FEATHER_VERTEX_YS.map((vertexY) => (
                <polyline
                  key={`tail-feather-halo-${vertexY}`}
                  points={tailFeatherPoints(vertexY)}
                  fill="none"
                  stroke="rgba(3, 7, 18, 0.85)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {TAIL_FEATHER_VERTEX_YS.map((vertexY) => (
                <polyline
                  key={`tail-feather-${vertexY}`}
                  points={tailFeatherPoints(vertexY)}
                  className="arrow-head stroke-current"
                  fill="none"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>

            {/* Centre annotation — avionics instrument tag, static, always on top of the rotating arrow */}
            <g id="centre-wind-label">
              <rect
                x="154"
                y="188"
                width="92"
                height="24"
                rx="6"
                ry="6"
                fill="rgba(15, 23, 42, 0.94)"
                stroke="rgba(148, 163, 184, 0.28)"
                strokeWidth="1"
                style={{ filter: 'drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45))' }}
              />
              <text
                x="200"
                y="200"
                textAnchor="middle"
                dominantBaseline="middle"
                className="select-none"
                fill="white"
                fontSize="16"
                fontWeight="700"
                fontFamily="monospace"
                letterSpacing="0.5"
              >
                {compassState.windDirection} / {compassState.windSpeed}
              </text>
            </g>
          </svg>
        </div>

      {/* INSTRUMENT READOUT PANEL — fixed-width right-aligned labels, left-aligned values, no cards/borders/dividers.
          liveDataUnavailable: the selected source's fetch failed and compassState is actually
          derived from the substituted mock fixture - show N/A rather than presenting that fake
          data as if it were a real reading.
          No Gust row any more - confirmed directly against the Davis
          Vantage Pro2's own station page (every id-tagged element across
          20 stored historic captures) that it has never exposed a
          distinct gust value, only current wind and a separate 10-minute
          average - this was never a fixable UI gap, so the row (which
          only ever read 'N/A'/'—' off real hardware) is gone rather than
          left showing a permanently-empty reading. Auto-flow grid rows
          (no fixed row template), so removing it closes the gap on its
          own - every row below shifts up automatically.
          Temp/QNH also gone now, same auto-flow closing - both are
          already shown in the Weather Summary panel next to this one on
          the desktop dashboard (and in the equivalent grid above the
          compass on Pilot View mobile), so duplicating them a second
          time in this readout was redundant, not a second useful view of
          the same numbers. Wind/Headwind/Crosswind/Trend are the only
          things genuinely specific to this instrument. */}
      {!hideReadout && (
        <div className={`grid grid-cols-[120px_1fr] items-baseline gap-x-4 ${spacious ? 'gap-y-4' : 'gap-y-2.5'}`}>
          <ReadoutRow
            label="Wind"
            value={liveDataUnavailable ? 'N/A' : `${compassState.windDirection}° / ${compassState.windSpeed} kt`}
            labelFontSizeOverride={spacious ? PILOT_READOUT_LABEL_FONT : undefined}
          />
          <ReadoutRow
            label={liveDataUnavailable ? 'Headwind' : headwindLabel}
            value={liveDataUnavailable ? 'N/A' : `${headwindMagnitude.toFixed(1)} kt`}
            valueClassName={liveDataUnavailable ? 'text-slate-500' : headwindColour}
            labelFontSizeOverride={spacious ? PILOT_READOUT_LABEL_FONT : undefined}
          />
          <ReadoutRow
            label="Crosswind"
            value={liveDataUnavailable ? 'N/A' : `${Math.abs(compassState.crosswind).toFixed(1)} kt ${compassState.crosswind > 0 ? 'Right' : 'Left'}`}
            valueClassName={liveDataUnavailable ? 'text-slate-500' : crosswindColour}
            labelFontSizeOverride={spacious ? PILOT_READOUT_LABEL_FONT : undefined}
          />
          <ReadoutRow
            label="Trend"
            value={liveDataUnavailable ? 'N/A' : `${trendSymbol} ${trendLabel}`}
            valueClassName={liveDataUnavailable ? 'text-slate-500' : trendColour}
            labelFontSizeOverride={spacious ? PILOT_READOUT_LABEL_FONT : undefined}
          />
        </div>
      )}
    </div>
  )
}
