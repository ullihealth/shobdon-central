import { useEffect, useMemo, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import type { RunwayGroup, RunwayStrip } from '../types/clubProfile'
import { calculateWindComponents, determineArrowColour } from '../utils/windCalculations'
import type { ArrowColour } from '../utils/windCalculations'
import type { PressureTrend } from '../types/weather'

interface CompassState {
  windSpeed: number
  windDirection: number
  windGust?: number
  temperature: number
  qnh: number
  pressureTrend: PressureTrend
  headwind: number
  crosswind: number
  arrowColour: ArrowColour
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

// 0.83 leaves clear margin between each glyph's rendered edge and the ring,
// replacing the previous inconsistent per-letter radii (172/172/182/172),
// where N/E/W nearly touched the ring and S sat past it entirely.
const CARDINAL_LETTER_RADIUS = RING_RADIUS * 0.83

// Pre-existing correction, preserved as-is at the new radius - likely
// compensating for dominantBaseline="middle" centering less reliably than
// textAnchor="middle" does across browsers (N/S never needed an equivalent
// horizontal nudge).
const CARDINAL_LETTER_VERTICAL_NUDGE = 8

const NORTH_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 0)
const EAST_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 90)
const SOUTH_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 180)
const WEST_POINT = circlePoint(200, 200, CARDINAL_LETTER_RADIUS, 270)

// Shobdon's own seeded runway group keeps its exact hand-tuned literal pixel
// cross-axis positions (centreline at 214 etc.) rather than the general
// derived formula below - this is the one group where pixel-identical
// colour/position rendering is a hard requirement. Strip WIDTH is a
// per-strip field (RunwayStrip.widthPx) - each physical strip in a group
// (e.g. a narrower grass strip beside a wider tarmac one) is independently
// sized - see the width formulas inside RunwayGroupGraphic below. Along-
// axis length is still shared per-group (see RUNWAY_STRIP_* below).
const SHOBDON_SEEDED_GROUP_ID = 'shobdon-08-26'

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

// Threshold (checkerboard) markings: the square is a fixed pixel size,
// deliberately NOT derived from the strip's own width - a wider strip just
// tiles more squares across itself (via the SVG pattern's own repeat),
// rather than each square growing along with the strip. 5.5px reproduces
// the pattern's original visual size at Shobdon's seeded 22px-wide strips
// (22 / the old 4-column-derived formula), so nothing changes there by
// switching to a fixed constant.
const THRESHOLD_MARKING_SQUARE_SIZE_PX = 5.5

// Fixed length (along the strip's own axis) of the checkerboard block at
// each end - independent of strip width AND of wherever the identifier
// numeral currently sits. Previously this block's rendered size was tied
// to the numeral's inset, so pushing the numeral out to clear the block
// made the block itself grow to match - a feedback loop that visibly
// bloated the grid. Keeping it fixed and moving only the numeral fixes
// that.
const THRESHOLD_MARKING_BLOCK_LENGTH = 20

// Visible clearance between the checkerboard block's inner edge and the
// identifier numeral, when that strip's markings are on.
const THRESHOLD_MARKING_LABEL_GAP = 8

// Identifier numeral inset from each strip end - unchanged "previous
// position" when that strip's threshold markings are off.
const NUMBER_INSET_DEFAULT = 20
const NUMBER_INSET_WITH_MARKINGS = THRESHOLD_MARKING_BLOCK_LENGTH + THRESHOLD_MARKING_LABEL_GAP

function ThresholdMarkingPattern({ patternId }: { patternId: string }): JSX.Element {
  const size = THRESHOLD_MARKING_SQUARE_SIZE_PX
  return (
    <defs>
      <pattern id={patternId} patternUnits="userSpaceOnUse" width={size * 2} height={size * 2}>
        <rect width={size * 2} height={size * 2} fill="white" />
        <rect width={size} height={size} fill="#1e293b" />
        <rect x={size} y={size} width={size} height={size} fill="#1e293b" />
      </pattern>
    </defs>
  )
}

// One fixed-length checkerboard block at each end of a single physical
// strip - twin groups call this once per strip, not once per group, and
// only for strips that have their own markings toggled on.
function ThresholdMarkingBlocks({
  patternId,
  stripX,
  stripWidth,
  stripTop,
  stripBottom,
}: {
  patternId: string
  stripX: number
  stripWidth: number
  stripTop: number
  stripBottom: number
}): JSX.Element {
  return (
    <>
      <rect x={stripX} y={stripTop} width={stripWidth} height={THRESHOLD_MARKING_BLOCK_LENGTH} fill={`url(#${patternId})`} />
      <rect x={stripX} y={stripBottom - THRESHOLD_MARKING_BLOCK_LENGTH} width={stripWidth} height={THRESHOLD_MARKING_BLOCK_LENGTH} fill={`url(#${patternId})`} />
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

function splitRunwayLabel(label: string): [string, string] {
  const [first = '', second = ''] = label.split('/').map((part) => part.trim())
  return [first, second]
}

function RunwayGroupGraphic({ group }: { group: RunwayGroup }): JSX.Element {
  const [labelTop, labelBottom] = splitRunwayLabel(group.label)
  const halfLength = clampStripHalfLength(group.stripLengthPx / 2)
  const stripTop = 200 - halfLength
  const stripBottom = 200 + halfLength
  const stripHeight = halfLength * 2
  const centrelineTop = stripTop - 10
  const centrelineBottom = stripBottom + 10
  const patternId = `threshold-${group.id}`
  const fontSize = group.identifierFontSizePx

  if (group.id === SHOBDON_SEEDED_GROUP_ID) {
    const [grass, tarmac] = group.strips
    const grassWidth = clampStripWidth(grass?.widthPx ?? 22)
    const tarmacWidth = clampStripWidth(tarmac?.widthPx ?? 22)
    // Centreline stays anchored to the tarmac strip's own centre (214) -
    // matches the real-world detail that only the paved surface has a
    // painted line - independent of width. At the seeded 22px widths this
    // reproduces today's exact literal positions (176/203/214) exactly.
    const tarmacX = 214 - tarmacWidth / 2
    const grassX = tarmacX - RUNWAY_STRIP_GAP - grassWidth
    const thresholdLeft = grassX
    const thresholdRight = tarmacX + tarmacWidth
    const grassInset = numberInsetFor(grass)
    const tarmacInset = numberInsetFor(tarmac)
    const grassNumberTopY = stripTop + grassInset
    const grassNumberBottomY = stripBottom - grassInset
    const tarmacNumberTopY = stripTop + tarmacInset
    const tarmacNumberBottomY = stripBottom - tarmacInset
    return (
      <g transform={`rotate(${group.headingDegrees} 200 200)`}>
        {grass?.hasThresholdMarkings && <ThresholdMarkingPattern patternId={`${patternId}-grass`} />}
        {tarmac?.hasThresholdMarkings && <ThresholdMarkingPattern patternId={`${patternId}-tarmac`} />}
        {/* Grass Strip (Left) */}
        <rect x={grassX} y={stripTop} width={grassWidth} height={stripHeight} fill={grass?.colour ?? '#4caf50'} opacity="0.65" />
        {/* Tarmac Strip (Right) */}
        <rect x={tarmacX} y={stripTop} width={tarmacWidth} height={stripHeight} fill={tarmac?.colour ?? '#a8b4c4'} opacity="0.5" />
        {grass?.hasThresholdMarkings && (
          <ThresholdMarkingBlocks patternId={`${patternId}-grass`} stripX={grassX} stripWidth={grassWidth} stripTop={stripTop} stripBottom={stripBottom} />
        )}
        {tarmac?.hasThresholdMarkings && (
          <ThresholdMarkingBlocks patternId={`${patternId}-tarmac`} stripX={tarmacX} stripWidth={tarmacWidth} stripTop={stripTop} stripBottom={stripBottom} />
        )}
        {/* Centreline (dashed) */}
        <line x1="214" y1={centrelineTop} x2="214" y2={centrelineBottom} stroke="white" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.18" />
        {/* Threshold Markers */}
        <line x1={thresholdLeft} y1={stripTop} x2={thresholdRight} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
        <line x1={thresholdLeft} y1={stripBottom} x2={thresholdRight} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
        {/* Runway Numbers - each strip shows its own pair independently,
            positioned over its own centre, opacity 0.85 to match other
            secondary compass labels (e.g. intermediate bearings). */}
        {grass?.showIdentifierLabel && (
          <>
            <text x={grassX + grassWidth / 2} y={grassNumberTopY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelTop}</text>
            <text x={grassX + grassWidth / 2} y={grassNumberBottomY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelBottom}</text>
          </>
        )}
        {tarmac?.showIdentifierLabel && (
          <>
            <text x="214" y={tarmacNumberTopY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelTop}</text>
            <text x="214" y={tarmacNumberBottomY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelBottom}</text>
          </>
        )}
      </g>
    )
  }

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
        {stripA?.hasThresholdMarkings && <ThresholdMarkingPattern patternId={`${patternId}-a`} />}
        {stripB?.hasThresholdMarkings && <ThresholdMarkingPattern patternId={`${patternId}-b`} />}
        <rect x={stripAX} y={stripTop} width={stripAWidth} height={stripHeight} fill={stripA?.colour ?? '#4caf50'} opacity="0.65" />
        <rect x={stripBX} y={stripTop} width={stripBWidth} height={stripHeight} fill={stripB?.colour ?? '#a8b4c4'} opacity="0.5" />
        {stripA?.hasThresholdMarkings && (
          <ThresholdMarkingBlocks patternId={`${patternId}-a`} stripX={stripAX} stripWidth={stripAWidth} stripTop={stripTop} stripBottom={stripBottom} />
        )}
        {stripB?.hasThresholdMarkings && (
          <ThresholdMarkingBlocks patternId={`${patternId}-b`} stripX={stripBX} stripWidth={stripBWidth} stripTop={stripTop} stripBottom={stripBottom} />
        )}
        <line x1="200" y1={centrelineTop} x2="200" y2={centrelineBottom} stroke="white" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.18" />
        <line x1={leftEdge} y1={stripTop} x2={rightEdge} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
        <line x1={leftEdge} y1={stripBottom} x2={rightEdge} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
        {stripA?.showIdentifierLabel && (
          <>
            <text x={stripACentreX} y={stripANumberTopY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelTop}</text>
            <text x={stripACentreX} y={stripANumberBottomY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelBottom}</text>
          </>
        )}
        {stripB?.showIdentifierLabel && (
          <>
            <text x={stripBCentreX} y={stripBNumberTopY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelTop}</text>
            <text x={stripBCentreX} y={stripBNumberBottomY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelBottom}</text>
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
      {strip?.hasThresholdMarkings && <ThresholdMarkingPattern patternId={patternId} />}
      <rect x={stripX} y={stripTop} width={width} height={stripHeight} fill={strip?.colour ?? '#a8b4c4'} opacity="0.5" />
      {strip?.hasThresholdMarkings && (
        <ThresholdMarkingBlocks patternId={patternId} stripX={stripX} stripWidth={width} stripTop={stripTop} stripBottom={stripBottom} />
      )}
      <line x1="200" y1={centrelineTop} x2="200" y2={centrelineBottom} stroke="white" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.18" />
      <line x1={stripX} y1={stripTop} x2={edge} y2={stripTop} stroke="white" strokeWidth="2" opacity="0.18" />
      <line x1={stripX} y1={stripBottom} x2={edge} y2={stripBottom} stroke="white" strokeWidth="2" opacity="0.18" />
      {strip?.showIdentifierLabel && (
        <>
          <text x="200" y={numberTopY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelTop}</text>
          <text x="200" y={numberBottomY} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize={fontSize} fontWeight="900" opacity="0.85">{labelBottom}</text>
        </>
      )}
    </g>
  )
}

interface ReadoutRowProps {
  label: string
  value: string
  valueClassName?: string
}

function ReadoutRow({ label, value, valueClassName = 'text-white' }: ReadoutRowProps): JSX.Element {
  return (
    <>
      <div className="text-right text-[16px] font-semibold uppercase leading-none tracking-widest text-slate-400">{label}</div>
      <div className={`text-[28px] font-extrabold leading-none ${valueClassName}`}>{value}</div>
    </>
  )
}

export default function CompassPanel(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  // Was a synchronous loadClubProfile() (localStorage) read - now an
  // async fetch of the tenant-scoped public config endpoint, so
  // runwayGroups starts empty for one render until it resolves (matches
  // the same brief-loading-flash characteristic DashboardPage.tsx's
  // theme fetch has always had). No auth here deliberately - this is
  // the live public dashboard, which must keep working with zero login,
  // same as every device viewing it today (PC2, clubhouse display,
  // anyone with the link).
  const [clubProfile, setClubProfile] = useState<{ runwayGroups: RunwayGroup[] }>({ runwayGroups: [] })

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.runwayGroups) setClubProfile({ runwayGroups: data.runwayGroups })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const compassState = useMemo<CompassState | null>(() => {
    if (!weather || clubProfile.runwayGroups.length === 0) return null

    const activeRunwayHeading = clubProfile.runwayGroups[0].headingDegrees
    const { headwind, crosswind } = calculateWindComponents(
      weather.windSpeed,
      weather.windDirection,
      activeRunwayHeading
    )
    const arrowColour = determineArrowColour(headwind, crosswind)

    return {
      windSpeed: weather.windSpeed,
      windDirection: weather.windDirection,
      windGust: weather.windGust,
      temperature: weather.temperature,
      qnh: weather.qnh,
      pressureTrend: weather.pressureTrend,
      headwind,
      crosswind,
      arrowColour,
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

  return (
    <div className="flex h-full items-center justify-center gap-7 pt-6">
      {/* ── COMPASS INSTRUMENT ─────────────────────────────────────────
          Two overlapping SVGs sharing the same 400×400 viewBox.
          Layer 1 (bottom): static — compass rose and runway reference.
          Layer 2 (top):    live  — wind arrow only, always on top.
          Separate SVG elements guarantee the arrow can never merge
          with the runway regardless of wind/runway alignment.
          position:relative + left:-18px shifts ONLY this instrument left -
          unlike a negative margin, it doesn't drag the readout panel
          (the next flex sibling) along with it, since relative positioning
          doesn't affect where following siblings are laid out. */}
      <div className="relative left-[-18px] w-[clamp(200px,30vh,340px)] h-[clamp(200px,30vh,340px)] flex-shrink-0">

          {/* LAYER 1 — Static reference: compass rose + runway */}
          <svg
            viewBox="0 0 400 400"
            className="w-[clamp(200px,30vh,340px)] h-[clamp(200px,30vh,340px)]"
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

            {/* COMPASS ROSE - Cardinal Points */}
            <g id="cardinal-points" className="pointer-events-none">
              <text x={NORTH_POINT.x} y={NORTH_POINT.y} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">N</text>
              <text x={EAST_POINT.x} y={EAST_POINT.y + CARDINAL_LETTER_VERTICAL_NUDGE} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">E</text>
              <text x={SOUTH_POINT.x} y={SOUTH_POINT.y} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">S</text>
              <text x={WEST_POINT.x} y={WEST_POINT.y + CARDINAL_LETTER_VERTICAL_NUDGE} textAnchor="middle" dominantBaseline="middle" className="select-none" fill="white" fontSize="41" fontWeight="800">W</text>
            </g>

            {/* Cardinal Direction Lines */}
            <g id="cardinal-lines" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1.5">
              <line x1="200" y1="20" x2="200" y2="50" />
              <line x1="350" y1="200" x2="380" y2="200" />
              <line x1="200" y1="350" x2="200" y2="380" />
              <line x1="20" y1="200" x2="50" y2="200" />
            </g>

            {/* Intermediate Bearings */}
            <g id="intermediate-bearings" className="pointer-events-none">
              {INTERMEDIATE_BEARINGS.map((bearing) => {
                const point = circlePoint(200, 200, 153, bearing.degrees)
                return (
                  <text
                    key={`bearing-${bearing.degrees}`}
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
                )
              })}
            </g>

            {/* Degree Markers (every 30°) */}
            <g id="degree-markers" stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((degree) => {
                const point = circlePoint(200, 200, 175, degree)
                const innerPoint = circlePoint(200, 200, 163, degree)
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

            {/* RUNWAY GRAPHIC(S) - background reference axis; never to compete with the wind arrow */}
            <g id="runway-graphics">
              {clubProfile.runwayGroups.map((group) => (
                <RunwayGroupGraphic key={group.id} group={group} />
              ))}
            </g>

            {/* Centre Point */}
            <circle cx="200" cy="200" r="4" fill="white" opacity="0.5" />
          </svg>

          {/* LAYER 2 — Wind arrow + annotation: always renders above Layer 1 */}
          <svg
            viewBox="0 0 400 400"
            className="absolute inset-0 w-[clamp(200px,30vh,340px)] h-[clamp(200px,30vh,340px)]"
            style={{ pointerEvents: 'none' }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Rotating wind arrow — long, thin needle; always on its own layer above the runway */}
            <g
              id="wind-arrow"
              className={`wind-arrow ${arrowColourClass}`}
              transform={`rotate(${compassState.windDirection} 200 200)`}
              style={{ transition: 'transform 0.8s ease-in-out' }}
            >
              {/* Dark halo - keeps the needle legible over both runway strips */}
              <polygon points="200,37 213,80 207,80 207,362 193,362 193,80 187,80" fill="rgba(3, 7, 18, 0.85)" />
              {/* Full-length instrument needle: arrowhead + shaft through the centre to a plain tail, ~88% radius each way */}
              <polygon points="200,42 208,84 202,84 202,358 198,358 198,84 192,84" className="arrow-head fill-current" />
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
          data as if it were a real reading. */}
      <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4 gap-y-2.5">
        <ReadoutRow label="Wind" value={liveDataUnavailable ? 'N/A' : `${compassState.windDirection}° / ${compassState.windSpeed} kt`} />
        <ReadoutRow
          label="Gust"
          value={liveDataUnavailable ? 'N/A' : compassState.windGust ? `${compassState.windGust} kt` : '—'}
          valueClassName={compassState.windGust && !liveDataUnavailable ? 'text-amber-500' : 'text-slate-500'}
        />
        <ReadoutRow
          label="Headwind"
          value={liveDataUnavailable ? 'N/A' : `${compassState.headwind > 0 ? '+' : ''}${compassState.headwind.toFixed(1)} kt`}
          valueClassName={liveDataUnavailable ? 'text-slate-500' : headwindColour}
        />
        <ReadoutRow
          label="Crosswind"
          value={liveDataUnavailable ? 'N/A' : `${Math.abs(compassState.crosswind).toFixed(1)} kt ${compassState.crosswind > 0 ? 'Right' : 'Left'}`}
          valueClassName={liveDataUnavailable ? 'text-slate-500' : crosswindColour}
        />
        <ReadoutRow label="Trend" value={liveDataUnavailable ? 'N/A' : `${trendSymbol} ${trendLabel}`} valueClassName={liveDataUnavailable ? 'text-slate-500' : trendColour} />
        <ReadoutRow label="Temp" value={liveDataUnavailable ? 'N/A' : `${compassState.temperature}°C`} />
        <ReadoutRow label="QNH" value={liveDataUnavailable ? 'N/A' : `${compassState.qnh} hPa`} />
      </div>
    </div>
  )
}
