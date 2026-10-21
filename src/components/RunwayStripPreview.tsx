import type { RunwayGroup, RunwayStrip } from '../types/clubProfile'
import { runwayStripCount, stripExtent, stripLengthPct } from '../utils/runwayStrips'

// Deliberately NOT imported from or sharing any code with CompassPanel.tsx,
// the safety-relevant component driving the real public dashboard (has
// caused a real regression before). CompassPanel takes zero props - it
// always self-fetches the public config endpoint and depends on
// useWeather() context - and its runway-rendering logic
// (RunwayGroupGraphic) is a private, non-exported function, so reusing it
// here would require editing that file (even just adding an `export`
// keyword is still a change to it). Investigated and rejected on that
// basis alone - this file instead duplicates only the STATIC compass-rose
// + runway-strip geometry (no wind arrow, no weather dependency) so the
// two components can never affect each other. Keep this file's geometry
// constants in sync with CompassPanel.tsx by eye if that file's runway
// rendering ever changes - there is no shared source of truth by design.

const RING_RADIUS = 180

// Kept in sync by eye with CompassPanel.tsx's own fix (see that file's
// header comment for the full radii table and why 0.83/149px was too
// close to centre - closer than a long strip's rendered end, causing a
// visual "foul" between the runway graphic and the cardinal letters).
// N/E/S/W now sit at the true outer rim; the short dashed tick-mark band
// occupies the gap this used to sit flush against.
const CARDINAL_LETTER_RADIUS = RING_RADIUS - 12
const TICK_MARK_INNER_RADIUS = 156
const TICK_MARK_OUTER_RADIUS = 163
const CARDINAL_LETTER_VERTICAL_NUDGE = 8

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function circlePoint(centreX: number, centreY: number, radius: number, angleDegrees: number): { x: number; y: number } {
  const radians = degreesToRadians(angleDegrees)
  return {
    x: centreX + radius * Math.sin(radians),
    y: centreY - radius * Math.cos(radians),
  }
}

const NORTH_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 0)
const EAST_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 90)
const SOUTH_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 180)
const WEST_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 270)

const RUNWAY_STRIP_GAP = 5

// Three-strip layout only (see CompassPanel.tsx's identical constants): fallback
// colours and per-position fill opacity.
const THREE_STRIP_DEFAULT_COLOURS = ['#4caf50', '#a8b4c4', '#4caf50']
const THREE_STRIP_OPACITY = [0.65, 0.5, 0.5]
const MIN_STRIP_HALF_LENGTH = 30
const MIN_STRIP_WIDTH_PX = 4

function clampStripHalfLength(rawHalfLength: number): number {
  return Math.max(rawHalfLength, MIN_STRIP_HALF_LENGTH)
}

function clampStripWidth(rawWidth: number): number {
  return Math.max(rawWidth, MIN_STRIP_WIDTH_PX)
}

const THRESHOLD_STRIPE_COUNT = 5
const THRESHOLD_MARKING_BLOCK_LENGTH = 20
const THRESHOLD_MARKING_LABEL_GAP = 18
const NUMBER_INSET_DEFAULT = 20
const NUMBER_INSET_WITH_MARKINGS = THRESHOLD_MARKING_BLOCK_LENGTH + THRESHOLD_MARKING_LABEL_GAP

function numberInsetFor(strip: RunwayStrip | undefined): number {
  return strip?.hasThresholdMarkings ? NUMBER_INSET_WITH_MARKINGS : NUMBER_INSET_DEFAULT
}

function showsCenterline(strip: RunwayStrip | undefined): boolean {
  return strip?.showCenterline !== false
}

function ThresholdStripeSet({ stripX, stripWidth, blockY }: { stripX: number; stripWidth: number; blockY: number }): JSX.Element {
  const thickness = stripWidth / (THRESHOLD_STRIPE_COUNT * 2)
  const step = thickness * 2
  return (
    <>
      {Array.from({ length: THRESHOLD_STRIPE_COUNT }, (_, i) => (
        <rect key={i} x={stripX + i * step} y={blockY} width={thickness} height={THRESHOLD_MARKING_BLOCK_LENGTH} fill="white" shapeRendering="crispEdges" />
      ))}
    </>
  )
}

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

function RunwayIdentifierText({
  x,
  y,
  text,
  fontSize,
  rotate180,
}: {
  x: number
  y: number
  text: string
  fontSize: number
  rotate180?: boolean
}): JSX.Element {
  const textEl = (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">
      {text}
    </text>
  )
  return rotate180 ? <g transform={`rotate(180 ${x} ${y})`}>{textEl}</g> : textEl
}

// Mirrors CompassPanel.tsx's RunwayGroupGraphic exactly (same geometry)
// so a staged edit previews pixel-identically to how it will actually
// render once published - but this function has no import path to or
// from that file. Its old Shobdon-seeded special case (hardcoded
// tarmac-centre-at-x=214 anchor) was removed alongside CompassPanel.tsx's
// own copy of the same bug - see that file's comment above its own
// group.twin branch for the full root-cause explanation. This file's
// twin branch already used the correct width-independent "centre the
// gap around the true pivot" formula, so it needed no changes beyond
// deleting the special case that was shadowing it.
function RunwayStripGraphic({ group }: { group: RunwayGroup }): JSX.Element {
  const labelTop = group.endAIdentifier
  const labelBottom = group.endBIdentifier
  const halfLength = clampStripHalfLength(group.stripLengthPx / 2)
  const stripTop = 200 - halfLength
  const stripBottom = 200 + halfLength
  const stripHeight = halfLength * 2
  const centrelineTop = stripTop
  const centrelineBottom = stripBottom
  const fontSize = group.identifierFontSizePx

  // Three parallel strips (opt-in: only a runway saved with 3 strips reaches
  // this branch - every 1- and 2-strip runway falls through to the twin /
  // single branches below, completely untouched). Same spacing logic as the
  // twin branch (this preview, like that one, has no threshold light bars): each strip keeps its own width, the physical gap between
  // neighbours is exactly RUNWAY_STRIP_GAP, and the whole group is centred on
  // the runway line (x = 200) by its overall width.
  if (runwayStripCount(group) === 3) {
    const threeStrips = group.strips.slice(0, 3)
    const widths = threeStrips.map((strip) => clampStripWidth(strip?.widthPx ?? 22))
    const groupWidth = widths[0] + widths[1] + widths[2] + RUNWAY_STRIP_GAP * 2
    let cursorX = 200 - groupWidth / 2
    const layout = threeStrips.map((strip, index) => {
      const x = cursorX
      cursorX += widths[index] + RUNWAY_STRIP_GAP
      const inset = numberInsetFor(strip)
      const extent = stripExtent(stripTop, stripBottom, stripHeight, stripLengthPct(strip))
      return {
        strip,
        x,
        width: widths[index],
        centreX: x + widths[index] / 2,
        colour: strip?.colour ?? THREE_STRIP_DEFAULT_COLOURS[index],
        opacity: THREE_STRIP_OPACITY[index],
        top: extent.top,
        bottom: extent.bottom,
        height: extent.height,
        numberTopY: extent.top + inset,
        numberBottomY: extent.bottom - inset,
      }
    })
    const anyShortened = threeStrips.some((strip) => stripLengthPct(strip) < 100)
    const leftEdge = layout[0].x
    const rightEdge = layout[2].x + layout[2].width
    return (
      <g transform={`rotate(${group.headingDegrees} 200 200)`}>
        {layout.map((l, i) => (
          <rect key={`rect-${i}`} x={l.x} y={l.top} width={l.width} height={l.height} fill={l.colour} opacity={l.opacity} />
        ))}
        {layout.map((l, i) =>
          l.strip?.hasThresholdMarkings ? (
            <ThresholdMarkingBlocks key={`marks-${i}`} stripX={l.x} stripWidth={l.width} stripTop={l.top} stripBottom={l.bottom} />
          ) : null
        )}
        {layout.map((l, i) =>
          showsCenterline(l.strip) ? (
            <line key={`centre-${i}`} x1={l.centreX} y1={l.top} x2={l.centreX} y2={l.bottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />
          ) : null
        )}
        {anyShortened ? (
          layout.map((l, i) => (
            <g key={`cap-${i}`}>
              <line x1={l.x} y1={l.top} x2={l.x + l.width} y2={l.top} stroke="white" strokeWidth="2" opacity="0.18" />
              <line x1={l.x} y1={l.bottom} x2={l.x + l.width} y2={l.bottom} stroke="white" strokeWidth="2" opacity="0.18" />
            </g>
          ))
        ) : (
          <>
            <line x1={leftEdge} y1={stripTop} x2={rightEdge} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
            <line x1={leftEdge} y1={stripBottom} x2={rightEdge} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
          </>
        )}
        {layout.map((l, i) =>
          l.strip?.showIdentifierLabel ? (
            <g key={`label-${i}`}>
              <RunwayIdentifierText x={l.centreX} y={l.numberTopY} text={labelTop} fontSize={fontSize} rotate180 />
              <RunwayIdentifierText x={l.centreX} y={l.numberBottomY} text={labelBottom} fontSize={fontSize} />
            </g>
          ) : null
        )}
      </g>
    )
  }

  if (group.twin) {
    const [stripA, stripB] = group.strips
    const stripAWidth = clampStripWidth(stripA?.widthPx ?? 22)
    const stripBWidth = clampStripWidth(stripB?.widthPx ?? 22)
    const stripBX = 200 + RUNWAY_STRIP_GAP / 2
    const stripAX = 200 - RUNWAY_STRIP_GAP / 2 - stripAWidth
    const leftEdge = stripAX
    const rightEdge = stripBX + stripBWidth
    const stripACentreX = stripAX + stripAWidth / 2
    const stripBCentreX = stripBX + stripBWidth / 2
    const stripAInset = numberInsetFor(stripA)
    const stripBInset = numberInsetFor(stripB)
    const extA = stripExtent(stripTop, stripBottom, stripHeight, stripLengthPct(stripA))
    const extB = stripExtent(stripTop, stripBottom, stripHeight, stripLengthPct(stripB))
    const anyShortened = extA.shortened || extB.shortened
    const stripANumberTopY = extA.top + stripAInset
    const stripANumberBottomY = extA.bottom - stripAInset
    const stripBNumberTopY = extB.top + stripBInset
    const stripBNumberBottomY = extB.bottom - stripBInset
    return (
      <g transform={`rotate(${group.headingDegrees} 200 200)`}>
        <rect x={stripAX} y={extA.top} width={stripAWidth} height={extA.height} fill={stripA?.colour ?? '#4caf50'} opacity="0.65" />
        <rect x={stripBX} y={extB.top} width={stripBWidth} height={extB.height} fill={stripB?.colour ?? '#a8b4c4'} opacity="0.5" />
        {stripA?.hasThresholdMarkings && <ThresholdMarkingBlocks stripX={stripAX} stripWidth={stripAWidth} stripTop={extA.top} stripBottom={extA.bottom} />}
        {stripB?.hasThresholdMarkings && <ThresholdMarkingBlocks stripX={stripBX} stripWidth={stripBWidth} stripTop={extB.top} stripBottom={extB.bottom} />}
        {showsCenterline(stripA) && (
          <line x1={stripACentreX} y1={extA.top} x2={stripACentreX} y2={extA.bottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />
        )}
        {showsCenterline(stripB) && (
          <line x1={stripBCentreX} y1={extB.top} x2={stripBCentreX} y2={extB.bottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />
        )}
        {anyShortened ? (
          <>
            <line x1={stripAX} y1={extA.top} x2={stripAX + stripAWidth} y2={extA.top} stroke="white" strokeWidth="2" opacity="0.18" />
            <line x1={stripAX} y1={extA.bottom} x2={stripAX + stripAWidth} y2={extA.bottom} stroke="white" strokeWidth="2" opacity="0.18" />
            <line x1={stripBX} y1={extB.top} x2={stripBX + stripBWidth} y2={extB.top} stroke="white" strokeWidth="2" opacity="0.18" />
            <line x1={stripBX} y1={extB.bottom} x2={stripBX + stripBWidth} y2={extB.bottom} stroke="white" strokeWidth="2" opacity="0.18" />
          </>
        ) : (
          <>
            <line x1={leftEdge} y1={stripTop} x2={rightEdge} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
            <line x1={leftEdge} y1={stripBottom} x2={rightEdge} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
          </>
        )}
        {stripA?.showIdentifierLabel && (
          <>
            <RunwayIdentifierText x={stripACentreX} y={stripANumberTopY} text={labelTop} fontSize={fontSize} rotate180 />
            <RunwayIdentifierText x={stripACentreX} y={stripANumberBottomY} text={labelBottom} fontSize={fontSize} />
          </>
        )}
        {stripB?.showIdentifierLabel && (
          <>
            <RunwayIdentifierText x={stripBCentreX} y={stripBNumberTopY} text={labelTop} fontSize={fontSize} rotate180 />
            <RunwayIdentifierText x={stripBCentreX} y={stripBNumberBottomY} text={labelBottom} fontSize={fontSize} />
          </>
        )}
      </g>
    )
  }

  const [strip] = group.strips
  const width = clampStripWidth(strip?.widthPx ?? 44)
  const stripX = 200 - width / 2
  const edge = stripX + width
  const inset = numberInsetFor(strip)
  const ext = stripExtent(stripTop, stripBottom, stripHeight, stripLengthPct(strip))
  const numberTopY = ext.top + inset
  const numberBottomY = ext.bottom - inset
  return (
    <g transform={`rotate(${group.headingDegrees} 200 200)`}>
      <rect x={stripX} y={ext.top} width={width} height={ext.height} fill={strip?.colour ?? '#a8b4c4'} opacity="0.5" />
      {strip?.hasThresholdMarkings && <ThresholdMarkingBlocks stripX={stripX} stripWidth={width} stripTop={ext.top} stripBottom={ext.bottom} />}
      {showsCenterline(strip) && <line x1="200" y1={ext.top} x2="200" y2={ext.bottom} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="6,4" opacity="1" />}
      <line x1={stripX} y1={ext.top} x2={edge} y2={ext.top} stroke="white" strokeWidth="2" opacity="0.18" />
      <line x1={stripX} y1={ext.bottom} x2={edge} y2={ext.bottom} stroke="white" strokeWidth="2" opacity="0.18" />
      {strip?.showIdentifierLabel && (
        <>
          <RunwayIdentifierText x={200} y={numberTopY} text={labelTop} fontSize={fontSize} rotate180 />
          <RunwayIdentifierText x={200} y={numberBottomY} text={labelBottom} fontSize={fontSize} />
        </>
      )}
    </g>
  )
}

// Compass-mode round (/runways): dialRotationDegrees mirrors
// CompassPanel.tsx's own "rotate the rose+runway group, counter-rotate
// each cardinal letter to stay upright" treatment exactly (same rotate()
// formula, same per-letter counter-rotation wrapper) - duplicated here
// rather than imported, same "no shared code with CompassPanel.tsx"
// boundary this file's own header comment already established for the
// static geometry. The caller (RunwaysPage.tsx) computes the actual
// angle via windCalculations.ts's shared resolveActiveRunwayHeading, so
// at least THAT formula - the one that's already caused a real bug once
// from being hand-duplicated - isn't a third copy. Defaults to 0
// (North-up, today's unchanged behaviour) so this prop is optional and
// every pre-existing caller is unaffected.
//
// Admin-side, edit-time preview of ONE staged (possibly unsaved) runway
// group - the /runways page's dropdown scopes editing to a single group
// at a time, so the preview mirrors that scope rather than showing every
// configured runway at once the way the live dashboard's compass does.
export default function RunwayStripPreview({
  group,
  dialRotationDegrees = 0,
}: {
  group: RunwayGroup
  dialRotationDegrees?: number
}): JSX.Element {
  return (
    <svg viewBox="0 0 400 400" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <circle cx="200" cy="200" r={RING_RADIUS} fill="var(--color-compass-disc-bg)" stroke="rgba(59, 130, 246, 0.25)" strokeWidth="1.5" />

      <g transform={`rotate(${dialRotationDegrees} 200 200)`} style={{ transition: 'transform 0.8s ease-in-out' }}>
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

        <g id="degree-markers" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((degree) => {
            const point = circlePoint(200, 200, TICK_MARK_OUTER_RADIUS, degree)
            const innerPoint = circlePoint(200, 200, TICK_MARK_INNER_RADIUS, degree)
            return <line key={`marker-${degree}`} x1={point.x} y1={point.y} x2={innerPoint.x} y2={innerPoint.y} />
          })}
        </g>

        <g id="runway-graphic">
          <RunwayStripGraphic group={group} />
        </g>
      </g>

      <circle cx="200" cy="200" r="4" fill="white" opacity="0.5" />
    </svg>
  )
}
