import type { VisibilityHour } from '../services/visibilityForecastService'

interface CloudVisibilityChartProps {
  cloudBaseFt: number | null
  visibilityHours: VisibilityHour[]
}

// Fixed viewBox, stretched to fill whatever box the flex layout gives it
// (preserveAspectRatio="none") - same fixed-viewBox-plus-computed-
// coordinates convention as CompassPanel.tsx, adapted for a rectangular
// (not square) chart whose real available height varies a lot by kiosk
// viewport, per this panel's own history of overflow bugs. Measured
// empirically against real rendered output at 1366x768 and other sizes
// before finalising these numbers.
const VIEW_WIDTH = 320
const VIEW_HEIGHT = 230
const PLOT_LEFT = 34
const PLOT_RIGHT = VIEW_WIDTH - 8
const PLOT_TOP = 12
const HEIGHT_SCALE_BOTTOM = 150
const TREND_STRIP_CENTER_Y = 186
const TREND_LABEL_Y = 222

const GRIDLINE_STEP_FT = 1000
// Floor for the dynamic scale, and what's used when cloud base is N/A
// (gridlines/scale still render meaningfully even with no real height to
// plot) - matches the approved plan exactly.
const MIN_SCALE_MAX_FT = 3000

function scaleMaxFtFor(cloudBaseFt: number | null): number {
  if (cloudBaseFt === null) return MIN_SCALE_MAX_FT
  return Math.max(MIN_SCALE_MAX_FT, Math.ceil((cloudBaseFt + 500) / 1000) * 1000)
}

function ftToY(ft: number, scaleMaxFt: number): number {
  const clamped = Math.min(Math.max(ft, 0), scaleMaxFt)
  return HEIGHT_SCALE_BOTTOM - (clamped / scaleMaxFt) * (HEIGHT_SCALE_BOTTOM - PLOT_TOP)
}

// Exact table from the approved design: the CURRENT hour's real
// visibility category controls how many cloud icons appear (and how
// dark they are) in the top cluster - worse visibility reads as more,
// darker icons. Falls back to the Moderate entry if cloud base is known
// but the current hour's category isn't (Met Office briefly unreachable)
// - still shows a real cloud row at the real height, just without the
// extra visibility encoding for that one glitch.
const VISIBILITY_ICON_STYLE: Record<string, { count: number; color: string }> = {
  Excellent: { count: 1, color: '#ffffff' },
  'Very Good': { count: 3, color: '#ffffff' },
  Good: { count: 5, color: '#d1d5db' },
  Moderate: { count: 7, color: '#d1d5db' },
  Poor: { count: 9, color: '#4b5563' },
  'Very Poor': { count: 11, color: '#4b5563' },
}
const DEFAULT_ICON_STYLE = VISIBILITY_ICON_STYLE.Moderate

// Plain SVG shape, not an emoji glyph - emoji render as fixed-colour
// artwork in every browser (the `fill` attribute has no effect on them),
// which would make the White/Light-grey/Dark-grey visibility encoding
// above impossible. A simple 3-lobe silhouette (matching CompassPanel's
// own plain-primitives convention) is genuinely recolourable.
function CloudIcon({ cx, cy, size, fill }: { cx: number; cy: number; size: number; fill: string }): JSX.Element {
  const r = size / 2
  return (
    <g fill={fill}>
      <circle cx={cx - r * 0.55} cy={cy + r * 0.15} r={r * 0.5} />
      <circle cx={cx + r * 0.55} cy={cy + r * 0.15} r={r * 0.5} />
      <circle cx={cx} cy={cy - r * 0.25} r={r * 0.6} />
      <rect x={cx - r * 0.95} y={cy} width={r * 1.9} height={r * 0.65} rx={r * 0.32} />
    </g>
  )
}

// Simplified to a handful of representative icon types per the approved
// design - this dashboard doesn't need night/day to render differently,
// so paired codes collapse to one glyph each. Every code still lands in
// its correct broad category (a rain code is never shown as sunny), just
// without the night/day distinction full text would carry. 28/Thunder
// shower (night) and 29/Thunder shower (day) confirmed against the
// official Met Office DataPoint code-definitions reference before
// shipping - both fall in the Thunder bucket here regardless, since that
// distinction doesn't change which icon this dashboard shows.
function weatherIconFor(code: number | undefined): string {
  if (code === undefined) return '–'
  if (code === 0 || code === 1) return '☀️' // Clear / Sunny
  if (code === 2 || code === 3) return '⛅' // Partly cloudy
  if (code === 5 || code === 6) return '🌫️' // Mist / Fog
  if (code === 7) return '🌥️' // Cloudy
  if (code === 8) return '☁️' // Overcast
  if (code >= 9 && code <= 15) return '🌧️' // Drizzle / rain, light-heavy
  if (code >= 16 && code <= 21) return '🧊' // Sleet / hail
  if (code >= 22 && code <= 27) return '❄️' // Snow
  if (code >= 28 && code <= 30) return '⛈️' // Thunder
  return '❓' // Unmapped (e.g. code 4, not used by the API)
}

export default function CloudVisibilityChart({ cloudBaseFt, visibilityHours }: CloudVisibilityChartProps): JSX.Element {
  const scaleMaxFt = scaleMaxFtFor(cloudBaseFt)
  const gridlines: number[] = []
  for (let ft = 0; ft <= scaleMaxFt; ft += GRIDLINE_STEP_FT) gridlines.push(ft)

  const cloudY = cloudBaseFt === null ? null : ftToY(cloudBaseFt, scaleMaxFt)
  const iconStyle = VISIBILITY_ICON_STYLE[visibilityHours[0]?.category ?? ''] ?? DEFAULT_ICON_STYLE
  const usableWidth = PLOT_RIGHT - PLOT_LEFT
  // Shrinks as count grows (1 icon at count=1 up to 11 at Very Poor) so
  // the densest case never overlaps - capped at 22 so the sparse cases
  // (1-3 icons) don't blow up into oversized shapes.
  const cloudIconSize = Math.min(22, usableWidth / (iconStyle.count + 1))
  const cloudIconXs = Array.from({ length: iconStyle.count }, (_, i) => {
    const spacing = usableWidth / (iconStyle.count + 1)
    return PLOT_LEFT + spacing * (i + 1)
  })

  const trendSlotWidth = (PLOT_RIGHT - PLOT_LEFT) / Math.max(1, visibilityHours.length)

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" className="h-full w-full">
      {/* Gridlines + ft labels */}
      <g stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
        {gridlines.map((ft) => (
          <line key={ft} x1={PLOT_LEFT} y1={ftToY(ft, scaleMaxFt)} x2={PLOT_RIGHT} y2={ftToY(ft, scaleMaxFt)} />
        ))}
      </g>
      <g fill="rgba(148, 163, 184, 0.85)" fontSize="9" fontWeight="600">
        {gridlines.map((ft) => (
          <text key={ft} x={PLOT_LEFT - 4} y={ftToY(ft, scaleMaxFt)} textAnchor="end" dominantBaseline="middle">
            {ft / 1000}k
          </text>
        ))}
      </g>

      {/* Current-conditions cloud cluster: a row of icons all at ONE real
          height (Shobdon's calculated Cloud Base) - never at any other
          height, since there is only one real data point. Icon COUNT and
          COLOUR encode the current hour's real visibility category. */}
      {cloudY !== null ? (
        cloudIconXs.map((x, i) => <CloudIcon key={i} cx={x} cy={cloudY} size={cloudIconSize} fill={iconStyle.color} />)
      ) : (
        <text
          x={(PLOT_LEFT + PLOT_RIGHT) / 2}
          y={(PLOT_TOP + HEIGHT_SCALE_BOTTOM) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(148, 163, 184, 0.85)"
          fontSize="11"
          fontWeight="600"
        >
          Cloud base unavailable
        </text>
      )}

      {/* 6-hour trend: weather-TYPE icon per upcoming hour, from Met
          Office's own significantWeatherCode - visibility itself is only
          represented above (the cluster), not duplicated here. */}
      {visibilityHours.length === 0 ? (
        <text
          x={(PLOT_LEFT + PLOT_RIGHT) / 2}
          y={TREND_STRIP_CENTER_Y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(148, 163, 184, 0.85)"
          fontSize="11"
          fontWeight="600"
        >
          Weather trend unavailable
        </text>
      ) : (
        visibilityHours.map((hour, i) => {
          const x = PLOT_LEFT + trendSlotWidth * i + trendSlotWidth / 2
          return (
            <g key={i}>
              <text x={x} y={TREND_STRIP_CENTER_Y} textAnchor="middle" dominantBaseline="middle" fontSize="20">
                {weatherIconFor(hour.weatherCode)}
              </text>
              <text
                x={x}
                y={TREND_LABEL_Y}
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.85)"
                fontSize="8"
                fontWeight="600"
              >
                +{i + 1}h
              </text>
            </g>
          )
        })
      )}
    </svg>
  )
}
