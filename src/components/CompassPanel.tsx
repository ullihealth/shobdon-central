import { useMemo, useState } from 'react'

interface WeatherData {
  windSpeed: number // knots
  windDirection: number // degrees (0–360)
  windGust?: number // knots
  temperature: number // Celsius
  qnh: number // millibars
  pressureTrend: 'rising' | 'falling' | 'steady'
}

interface CompassState {
  windSpeed: number
  windDirection: number
  windGust?: number
  temperature: number
  qnh: number
  pressureTrend: 'rising' | 'falling' | 'steady'
  headwind: number
  crosswind: number
  arrowColour: 'green' | 'amber' | 'red'
}

// Default mock data
const MOCK_WEATHER: WeatherData = {
  windSpeed: 14,
  windDirection: 250,
  windGust: 5,
  temperature: 16,
  qnh: 1013,
  pressureTrend: 'rising',
}

const RUNWAY_HEADING = 50 // Shobdon runway 05/23
const RUNWAY_NUMBERS = ['05', '23']

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


function calculateWindComponents(
  windSpeed: number,
  windDirection: number,
  runwayHeading: number
): { headwind: number; crosswind: number } {
  const windRadians = (windDirection * Math.PI) / 180
  const runwayRadians = (runwayHeading * Math.PI) / 180

  const headwind = windSpeed * Math.cos(windRadians - runwayRadians)
  const crosswind = windSpeed * Math.sin(windRadians - runwayRadians)

  return { headwind, crosswind }
}

function determineArrowColour(headwind: number, crosswind: number): 'green' | 'amber' | 'red' {
  const absCrosswind = Math.abs(crosswind)

  if (headwind < -2) {
    return 'red'
  }

  if (absCrosswind > 5) {
    return 'amber'
  }

  if (headwind < 3 && headwind >= -2) {
    return 'amber'
  }

  return 'green'
}

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

export default function CompassPanel(): JSX.Element {
  const [weather] = useState<WeatherData>(MOCK_WEATHER)

  const compassState = useMemo<CompassState>(() => {
    const { headwind, crosswind } = calculateWindComponents(
      weather.windSpeed,
      weather.windDirection,
      RUNWAY_HEADING
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
  }, [weather])

  const trendSymbol = useMemo(() => {
    switch (compassState.pressureTrend) {
      case 'rising':
        return '↗'
      case 'falling':
        return '↘'
      default:
        return '→'
    }
  }, [compassState.pressureTrend])

  const trendColour = useMemo(() => {
    switch (compassState.pressureTrend) {
      case 'rising':
        return 'text-green-500'
      case 'falling':
        return 'text-red-500'
      default:
        return 'text-slate-500'
    }
  }, [compassState.pressureTrend])

  const crosswindColour = useMemo(() => {
    return Math.abs(compassState.crosswind) > 5 ? 'text-amber-500' : 'text-slate-300'
  }, [compassState.crosswind])

  const headwindColour = useMemo(() => {
    return compassState.headwind > 0 ? 'text-green-500' : 'text-red-500'
  }, [compassState.headwind])

  const arrowColourClass = useMemo(() => {
    switch (compassState.arrowColour) {
      case 'green':
        return 'arrow-green'
      case 'amber':
        return 'arrow-amber'
      case 'red':
        return 'arrow-red'
    }
  }, [compassState.arrowColour])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      {/* TOP LABEL: WIND */}
      <div className="text-center pt-4">
        <div className="text-sm uppercase tracking-widest text-slate-400">Wind</div>
        <div className="text-4xl font-black text-white">
          {compassState.windDirection}° / {compassState.windSpeed} kt
        </div>
      </div>

      {/* MAIN COMPASS WITH SIDE LABELS - FLOATING DESIGN */}
      <div className="relative flex flex-1 w-full items-center justify-center gap-16 px-8">
        {/* LEFT LABELS */}
        <div className="flex flex-col items-end gap-10 text-right">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">Temperature</div>
            <div className="text-2xl font-bold text-white">{compassState.temperature}°C</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">QNH</div>
            <div className="text-2xl font-bold text-white">{compassState.qnh} mb</div>
          </div>
        </div>

        {/* SVG COMPASS CIRCLE - ENLARGED TO 308px (h-80 w-80) */}
        <svg
          viewBox="0 0 400 400"
          className="h-80 w-80 flex-shrink-0"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Glow filter for wind arrow */}
            <filter id="arrow-glow-filter" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="5" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background Circle */}
          <circle
            cx="200"
            cy="200"
            r="180"
            fill="rgba(15, 23, 42, 0.95)"
            stroke="rgba(59, 130, 246, 0.25)"
            strokeWidth="1.5"
          />

          {/* COMPASS ROSE - Cardinal Points */}
          <g id="cardinal-points" className="pointer-events-none">
            <text
              x="200"
              y="28"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="36"
              fontWeight="900"
            >
              N
            </text>
            <text
              x="372"
              y="208"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="36"
              fontWeight="900"
            >
              E
            </text>
            <text
              x="200"
              y="382"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="36"
              fontWeight="900"
            >
              S
            </text>
            <text
              x="28"
              y="208"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="36"
              fontWeight="900"
            >
              W
            </text>
          </g>

          {/* Cardinal Direction Lines */}
          <g id="cardinal-lines" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1.5">
            <line x1="200" y1="20" x2="200" y2="50" />
            <line x1="350" y1="200" x2="380" y2="200" />
            <line x1="200" y1="350" x2="200" y2="380" />
            <line x1="20" y1="200" x2="50" y2="200" />
          </g>

          {/* Intermediate Bearings (33, 3, 6, 12, 15, 21, 24, 30) */}
          <g id="intermediate-bearings" className="pointer-events-none">
            {INTERMEDIATE_BEARINGS.map((bearing) => {
              const point = circlePoint(200, 200, 155, bearing.degrees)
              return (
                <text
                  key={`bearing-${bearing.degrees}`}
                  x={point.x}
                  y={point.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="select-none"
                  fill="rgba(148, 163, 184, 0.7)"
                  fontSize="16"
                  fontWeight="600"
                >
                  {bearing.label}
                </text>
              )
            })}
          </g>

          {/* Degree Markers (every 30°) */}
          <g id="degree-markers" stroke="rgba(100, 116, 139, 0.15)" strokeWidth="1">
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

          {/* RUNWAY GRAPHIC - Two Parallel Strips (Grass & Tarmac) */}
          <g id="runway-graphic" transform={`rotate(${RUNWAY_HEADING} 200 200)`}>
            {/* Grass Strip (Left) - 12px wide */}
            <rect x="180" y="60" width="12" height="260" fill="#5a7d65" opacity="0.7" />

            {/* Tarmac Strip (Right) - 12px wide */}
            <rect x="208" y="60" width="12" height="260" fill="#a8b4c4" opacity="0.85" />

            {/* Tarmac Centreline (dashed) */}
            <line
              x1="214"
              y1="60"
              x2="214"
              y2="320"
              stroke="white"
              strokeWidth="1.5"
              strokeDasharray="6,4"
              opacity="0.5"
            />

            {/* Threshold Markers (tarmac strip) */}
            <line x1="205" y1="70" x2="219" y2="70" stroke="white" strokeWidth="2" opacity="0.6" />
            <line x1="205" y1="330" x2="219" y2="330" stroke="white" strokeWidth="2" opacity="0.6" />

            {/* Runway Numbers - positioned above strips */}
            <text
              x="186"
              y="95"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="14"
              fontWeight="900"
              opacity="0.8"
            >
              {RUNWAY_NUMBERS[0]}
            </text>
            <text
              x="214"
              y="315"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="14"
              fontWeight="900"
              opacity="0.8"
            >
              {RUNWAY_NUMBERS[1]}
            </text>
          </g>

          {/* WIND ARROW - Sleap-style (longer, thinner, dynamic colour) */}
          <g
            id="wind-arrow"
            className={`wind-arrow ${arrowColourClass}`}
            transform={`rotate(${compassState.windDirection} 200 200)`}
            style={{
              transition: 'transform 0.8s ease-in-out',
              transformOrigin: '200px 200px',
            }}
          >
            {/* Arrow head (triangle) - reaches closer to circumference */}
            <polygon
              points="200,50 180,95 220,95"
              className="arrow-head fill-current transition-all duration-300"
              filter="url(#arrow-glow-filter)"
            />

            {/* Arrow tail (line) - thinner, elegant */}
            <line
              x1="200"
              y1="95"
              x2="200"
              y2="200"
              className="arrow-tail stroke-current transition-all duration-300"
              strokeWidth="2.5"
            />
          </g>

          {/* CENTRE WIND LABEL - floating above runway */}
          <g id="centre-wind-label">
            {/* Background rounded rect */}
            <rect
              x="165"
              y="165"
              width="70"
              height="70"
              rx="6"
              ry="6"
              fill="rgba(15, 23, 42, 0.9)"
              stroke="rgba(59, 130, 246, 0.3)"
              strokeWidth="1"
            />
            {/* Wind direction */}
            <text
              x="200"
              y="180"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="22"
              fontWeight="700"
              fontFamily="monospace"
            >
              {compassState.windDirection}
            </text>
            {/* Separator */}
            <text
              x="200"
              y="195"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="rgba(148, 163, 184, 0.6)"
              fontSize="14"
              fontWeight="500"
            >
              /
            </text>
            {/* Wind speed */}
            <text
              x="200"
              y="215"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="22"
              fontWeight="700"
              fontFamily="monospace"
            >
              {compassState.windSpeed}
            </text>
          </g>

          {/* Centre Point */}
          <circle cx="200" cy="200" r="4" fill="white" opacity="0.5" />
        </svg>

        {/* RIGHT LABELS */}
        <div className="flex flex-col items-start gap-10 text-left">
          {compassState.windGust && (
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500">Gust</div>
              <div className="text-2xl font-bold text-amber-500">G {compassState.windGust} kt</div>
            </div>
          )}
          {!compassState.windGust && (
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-500">Gust</div>
              <div className="text-2xl font-bold text-slate-500">—</div>
            </div>
          )}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">Trend</div>
            <div className={`text-2xl font-bold ${trendColour}`}>{trendSymbol}</div>
          </div>
        </div>
      </div>

      {/* BOTTOM LABEL: HEADWIND / CROSSWIND */}
      <div className="text-center pb-4">
        <div className="text-sm uppercase tracking-widest text-slate-400">Headwind / Crosswind</div>
        <div className="flex gap-6 justify-center text-2xl font-bold mt-2">
          <span className={headwindColour}>
            HW {compassState.headwind > 0 ? '+' : ''}
            {compassState.headwind.toFixed(1)} kt
          </span>
          <span className={crosswindColour}>
            XW {Math.abs(compassState.crosswind).toFixed(1)} kt {compassState.crosswind > 0 ? 'R' : 'L'}
          </span>
        </div>
      </div>
    </div>
  )
}
