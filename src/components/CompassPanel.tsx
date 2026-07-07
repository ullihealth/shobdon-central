import { useMemo, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { loadClubProfile } from '../services/clubProfileStore'
import type { RunwayGroup } from '../types/clubProfile'
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

// Shobdon's own seeded runway group keeps its exact hand-tuned literal pixel
// offsets (176/203/214 etc.) rather than the general derived formula below -
// this is the one group where pixel-identical rendering is a hard
// requirement, not just a nice-to-have.
const SHOBDON_SEEDED_GROUP_ID = 'shobdon-08-26'

// Geometry for any OTHER (non-Shobdon) runway group: a clean, symmetric
// derivation instead of hand-tuned literals - offset = half the gap plus
// half a strip's width, either side of the group's own axis.
const GENERAL_STRIP_WIDTH = 22
const GENERAL_STRIP_GAP = 5
const GENERAL_TWIN_OFFSET = GENERAL_STRIP_GAP / 2 + GENERAL_STRIP_WIDTH / 2
const GENERAL_SINGLE_STRIP_WIDTH = GENERAL_STRIP_WIDTH * 2

function splitRunwayLabel(label: string): [string, string] {
  const [first = '', second = ''] = label.split('/').map((part) => part.trim())
  return [first, second]
}

function RunwayGroupGraphic({ group }: { group: RunwayGroup }): JSX.Element {
  const [labelTop, labelBottom] = splitRunwayLabel(group.label)

  if (group.id === SHOBDON_SEEDED_GROUP_ID) {
    const [grass, tarmac] = group.strips
    return (
      <g transform={`rotate(${group.headingDegrees} 200 200)`}>
        {/* Grass Strip (Left) */}
        <rect x="176" y="70" width="22" height="260" fill={grass?.colour ?? '#4caf50'} opacity="0.65" />
        {/* Tarmac Strip (Right) */}
        <rect x="203" y="70" width="22" height="260" fill={tarmac?.colour ?? '#a8b4c4'} opacity="0.5" />
        {/* Centreline (dashed) */}
        <line x1="214" y1="60" x2="214" y2="320" stroke="var(--color-text-primary)" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.18" />
        {/* Threshold Markers */}
        <line x1="176" y1="70" x2="225" y2="70" stroke="var(--color-text-primary)" strokeWidth="2" opacity="0.18" />
        <line x1="176" y1="330" x2="225" y2="330" stroke="var(--color-text-primary)" strokeWidth="2" opacity="0.18" />
        {/* Runway Numbers */}
        <text x="187" y="95" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="14" fontWeight="900" opacity="0.28">{labelTop}</text>
        <text x="214" y="315" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="14" fontWeight="900" opacity="0.28">{labelBottom}</text>
      </g>
    )
  }

  if (group.twin) {
    const [stripA, stripB] = group.strips
    const stripAX = 200 - GENERAL_TWIN_OFFSET - GENERAL_STRIP_WIDTH
    const stripBX = 200 + GENERAL_TWIN_OFFSET
    const leftEdge = stripAX
    const rightEdge = stripBX + GENERAL_STRIP_WIDTH
    return (
      <g transform={`rotate(${group.headingDegrees} 200 200)`}>
        <rect x={stripAX} y="70" width={GENERAL_STRIP_WIDTH} height="260" fill={stripA?.colour ?? '#4caf50'} opacity="0.65" />
        <rect x={stripBX} y="70" width={GENERAL_STRIP_WIDTH} height="260" fill={stripB?.colour ?? '#a8b4c4'} opacity="0.5" />
        <line x1="200" y1="60" x2="200" y2="320" stroke="var(--color-text-primary)" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.18" />
        <line x1={leftEdge} y1="70" x2={rightEdge} y2="70" stroke="var(--color-text-primary)" strokeWidth="2" opacity="0.18" />
        <line x1={leftEdge} y1="330" x2={rightEdge} y2="330" stroke="var(--color-text-primary)" strokeWidth="2" opacity="0.18" />
        <text x="200" y="95" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="14" fontWeight="900" opacity="0.28">{labelTop}</text>
        <text x="200" y="315" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="14" fontWeight="900" opacity="0.28">{labelBottom}</text>
      </g>
    )
  }

  // Not twin: one full-width strip centred on the group's own axis.
  const [strip] = group.strips
  const stripX = 200 - GENERAL_SINGLE_STRIP_WIDTH / 2
  const edge = stripX + GENERAL_SINGLE_STRIP_WIDTH
  return (
    <g transform={`rotate(${group.headingDegrees} 200 200)`}>
      <rect x={stripX} y="70" width={GENERAL_SINGLE_STRIP_WIDTH} height="260" fill={strip?.colour ?? '#a8b4c4'} opacity="0.5" />
      <line x1="200" y1="60" x2="200" y2="320" stroke="var(--color-text-primary)" strokeWidth="1.5" strokeDasharray="6,4" opacity="0.18" />
      <line x1={stripX} y1="70" x2={edge} y2="70" stroke="var(--color-text-primary)" strokeWidth="2" opacity="0.18" />
      <line x1={stripX} y1="330" x2={edge} y2="330" stroke="var(--color-text-primary)" strokeWidth="2" opacity="0.18" />
      <text x="200" y="95" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="14" fontWeight="900" opacity="0.28">{labelTop}</text>
      <text x="200" y="315" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="14" fontWeight="900" opacity="0.28">{labelBottom}</text>
    </g>
  )
}

interface ReadoutRowProps {
  label: string
  value: string
  valueClassName?: string
}

function ReadoutRow({ label, value, valueClassName = 'text-primary' }: ReadoutRowProps): JSX.Element {
  return (
    <>
      <div className="text-right text-[16px] font-semibold uppercase leading-none tracking-widest text-muted-400">{label}</div>
      <div className={`text-[28px] font-extrabold leading-none ${valueClassName}`}>{value}</div>
    </>
  )
}

export default function CompassPanel(): JSX.Element {
  const { weather } = useWeather()
  const [clubProfile] = useState(() => loadClubProfile())

  const compassState = useMemo<CompassState | null>(() => {
    if (!weather) return null

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
        return 'text-status-good'
      case 'falling':
        return 'text-status-bad'
      default:
        return 'text-muted-500'
    }
  }, [compassState])

  const crosswindColour = useMemo(() => {
    return Math.abs(compassState?.crosswind ?? 0) > 5 ? 'text-status-warn' : 'text-muted-300'
  }, [compassState])

  const headwindColour = useMemo(() => {
    return (compassState?.headwind ?? 0) > 0 ? 'text-status-good' : 'text-status-bad'
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
      <div className="flex h-full items-center justify-center text-muted-400">
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
          with the runway regardless of wind/runway alignment. */}
      <div className="relative h-80 w-80 flex-shrink-0">

          {/* LAYER 1 — Static reference: compass rose + runway */}
          <svg
            viewBox="0 0 400 400"
            className="h-80 w-80"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Background Circle */}
            <circle
              cx="200"
              cy="200"
              r="180"
              fill="var(--color-compass-fill)"
              stroke="var(--color-compass-ring)"
              strokeWidth="1.5"
            />

            {/* COMPASS ROSE - Cardinal Points */}
            <g id="cardinal-points" className="pointer-events-none">
              <text x="200" y="28" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="41" fontWeight="800">N</text>
              <text x="372" y="208" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="41" fontWeight="800">E</text>
              <text x="200" y="382" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="41" fontWeight="800">S</text>
              <text x="28" y="208" textAnchor="middle" dominantBaseline="middle" className="select-none" fill="var(--color-text-primary)" fontSize="41" fontWeight="800">W</text>
            </g>

            {/* Cardinal Direction Lines */}
            <g id="cardinal-lines" stroke="var(--color-compass-cardinal)" strokeWidth="1.5">
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
                    fill="var(--color-compass-markers)"
                    fillOpacity={0.85}
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
            <g id="degree-markers" stroke="var(--color-compass-markers)" strokeOpacity={0.25} strokeWidth="1">
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
            <circle cx="200" cy="200" r="4" fill="var(--color-text-primary)" opacity="0.5" />
          </svg>

          {/* LAYER 2 — Wind arrow + annotation: always renders above Layer 1 */}
          <svg
            viewBox="0 0 400 400"
            className="absolute inset-0 h-80 w-80"
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
                fill="var(--color-text-primary)"
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

      {/* INSTRUMENT READOUT PANEL — fixed-width right-aligned labels, left-aligned values, no cards/borders/dividers */}
      <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4 gap-y-2.5">
        <ReadoutRow label="Wind" value={`${compassState.windDirection}° / ${compassState.windSpeed} kt`} />
        <ReadoutRow
          label="Gust"
          value={compassState.windGust ? `${compassState.windGust} kt` : '—'}
          valueClassName={compassState.windGust ? 'text-status-warn' : 'text-muted-500'}
        />
        <ReadoutRow
          label="Headwind"
          value={`${compassState.headwind > 0 ? '+' : ''}${compassState.headwind.toFixed(1)} kt`}
          valueClassName={headwindColour}
        />
        <ReadoutRow
          label="Crosswind"
          value={`${Math.abs(compassState.crosswind).toFixed(1)} kt ${compassState.crosswind > 0 ? 'Right' : 'Left'}`}
          valueClassName={crosswindColour}
        />
        <ReadoutRow label="Trend" value={`${trendSymbol} ${trendLabel}`} valueClassName={trendColour} />
        <ReadoutRow label="Temp" value={`${compassState.temperature}°C`} />
        <ReadoutRow label="QNH" value={`${compassState.qnh} hPa`} />
      </div>
    </div>
  )
}
