import { useMemo, useState, useEffect } from 'react'

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

// Default mock data for now (will be replaced with real API data)
const MOCK_WEATHER: WeatherData = {
  windSpeed: 14,
  windDirection: 250,
  windGust: 5,
  temperature: 16,
  qnh: 1013,
  pressureTrend: 'rising',
}

const RUNWAY_HEADING = 50 // Shobdon runway 05/23: 50° / 230°
const RUNWAY_NUMBERS = ['05', '23']

/**
 * Calculate headwind and crosswind components
 */
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

/**
 * Determine arrow colour based on wind components
 */
function determineArrowColour(headwind: number, crosswind: number): 'green' | 'amber' | 'red' {
  const absCrosswind = Math.abs(crosswind)

  // Tailwind: red (dangerous)
  if (headwind < -2) {
    return 'red'
  }

  // Significant crosswind: amber (caution)
  if (absCrosswind > 5) {
    return 'amber'
  }

  // Marginal headwind: amber (review)
  if (headwind < 3 && headwind >= -2) {
    return 'amber'
  }

  // Good headwind: green (ideal)
  return 'green'
}

/**
 * Degree to radians
 */
function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Position a point on a circle
 */
function circlePoint(
  centreX: number,
  centreY: number,
  radius: number,
  angleDegrees: number
): { x: number; y: number } {
  const radians = degreesToRadians(angleDegrees)
  return {
    x: centreX + radius * Math.sin(radians),
    y: centreY - radius * Math.cos(radians), // Subtract because SVG Y increases downward
  }
}

export default function CompassPanel(): JSX.Element {
  const [weather, setWeather] = useState<WeatherData>(MOCK_WEATHER)

  // Compute compass state
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

  // Trend symbol
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

  // Crosswind badge colour
  const crosswindColour = useMemo(() => {
    return Math.abs(compassState.crosswind) > 5 ? 'text-amber-500' : 'text-slate-300'
  }, [compassState.crosswind])

  // Headwind text colour
  const headwindColour = useMemo(() => {
    return compassState.headwind > 0 ? 'text-green-500' : 'text-red-500'
  }, [compassState.headwind])

  // Arrow colour class
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
    <div className="flex h-full flex-col items-center justify-center gap-6 rounded-xl bg-slate-950/70 p-8">
      {/* TOP LABEL: WIND */}
      <div className="text-center">
        <div className="text-sm uppercase tracking-widest text-slate-400">Wind</div>
        <div className="text-3xl font-black text-white">
          {compassState.windDirection}° / {compassState.windSpeed} kt
        </div>
      </div>

      {/* MAIN COMPASS WITH SIDE LABELS */}
      <div className="relative flex w-full flex-1 items-center justify-center gap-12">
        {/* LEFT LABELS */}
        <div className="flex flex-col items-end gap-8 text-right">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">Temperature</div>
            <div className="text-2xl font-bold text-white">{compassState.temperature}°C</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500">QNH</div>
            <div className="text-2xl font-bold text-white">{compassState.qnh} mb</div>
          </div>
        </div>

        {/* SVG COMPASS CIRCLE */}
        <svg
          viewBox="0 0 400 400"
          className="h-64 w-64 flex-shrink-0"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Glow filter for wind arrow */}
            <filter id="arrow-glow-filter" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
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

          {/* COMPASS ROSE - Simplified */}
          {/* Cardinal Points (N, E, S, W) - ENLARGED */}
          <g id="cardinal-points" className="pointer-events-none">
            <text
              x="200"
              y="32"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="32"
              fontWeight="900"
              letterSpacing="2"
            >
              N
            </text>
            <text
              x="368"
              y="208"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="32"
              fontWeight="900"
              letterSpacing="2"
            >
              E
            </text>
            <text
              x="200"
              y="378"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="32"
              fontWeight="900"
              letterSpacing="2"
            >
              S
            </text>
            <text
              x="32"
              y="208"
              textAnchor="middle"
              dominantBaseline="middle"
              className="select-none"
              fill="white"
              fontSize="32"
              fontWeight="900"
              letterSpacing="2"
            >
              W
            </text>
          </g>

          {/* Cardinal Direction Lines */}
          <g id="cardinal-lines" stroke="rgba(59, 130, 246, 0.2)" strokeWidth="1.5">
            {/* N */}
            <line x1="200" y1="20" x2="200" y2="50" />
            {/* E */}
            <line x1="350" y1="200" x2="380" y2="200" />
            {/* S */}
            <line x1="200" y1="350" x2="200" y2="380" />
            {/* W */}
            <line x1="20" y1="200" x2="50" y2="200" />
          </g>

          {/* Simplified Degree Markers (every 30° instead of every 10°) */}
          <g id="degree-markers" stroke="rgba(100, 116, 139, 0.15)" strokeWidth="1">
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((degree) => {
              const point = circlePoint(200, 200, 175, degree)
              const innerPoint = circlePoint(200, 200, 165, degree)
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

          {/* RUNWAY GRAPHIC - Enhanced, Realistic, Dominant */}
          <g id="runway-graphic" transform={`rotate(${RUNWAY_HEADING} 200 200)`}>
            {/* Left runway edge (thicker, more realistic) */}
            <line x1="188" y1="60" x2="188" y2="340" stroke="white" strokeWidth="3" opacity="0.85" />

            {/* Right runway edge */}
            <line x1="212" y1="60" x2="212" y2="340" stroke="white" strokeWidth="3" opacity="0.85" />

            {/* Centre line (dashed) */}
            <line
              x1="200"
              y1="60"
              x2="200"
              y2="340"
              stroke="white"
              strokeWidth="1.5"
              strokeDasharray="8,6"
              opacity="0.4"
            />

            {/* Runway threshold markers (small perpendicular lines) */}
            <line x1="185" y1="70" x2="215" y2="70" stroke="white" strokeWidth="2" opacity="0.6" />
            <line x1="185" y1="330" x2="215" y2="330" stroke="white" strokeWidth="2" opacity="0.6" />

            {/* Runway Numbers */}
            <g id="runway-numbers">
              <text
                x="200"
                y="95"
                textAnchor="middle"
                dominantBaseline="middle"
                className="select-none"
                fill="white"
                fontSize="16"
                fontWeight="900"
                opacity="0.8"
              >
                {RUNWAY_NUMBERS[0]}
              </text>
              <text
                x="200"
                y="315"
                textAnchor="middle"
                dominantBaseline="middle"
                className="select-none"
                fill="white"
                fontSize="16"
                fontWeight="900"
                opacity="0.8"
              >
                {RUNWAY_NUMBERS[1]}
              </text>
            </g>
          </g>

          {/* WIND ARROW - Animated, Colour-coded */}
          <g
            id="wind-arrow"
            className={`wind-arrow ${arrowColourClass}`}
            transform={`rotate(${compassState.windDirection} 200 200)`}
            style={{
              transition: 'transform 0.6s ease-in-out',
              transformOrigin: '200px 200px',
            }}
          >
            {/* Arrow head (triangle) */}
            <polygon
              points="200,55 183,100 217,100"
              className={`arrow-head fill-current transition-all duration-300`}
              filter="url(#arrow-glow-filter)"
            />

            {/* Arrow tail (line) */}
            <line
              x1="200"
              y1="100"
              x2="200"
              y2="200"
              className={`arrow-tail stroke-current transition-all duration-300`}
              strokeWidth="4"
            />
          </g>

          {/* Centre Point */}
          <circle cx="200" cy="200" r="5" fill="white" opacity="0.6" />
        </svg>

        {/* RIGHT LABELS */}
        <div className="flex flex-col items-start gap-8 text-left">
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
      <div className="text-center">
        <div className="text-sm uppercase tracking-widest text-slate-400">Headwind / Crosswind</div>
        <div className="flex gap-6 justify-center text-2xl font-bold">
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
