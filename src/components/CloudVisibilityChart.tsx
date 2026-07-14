import type { VisibilityHour } from '../services/visibilityForecastService'

interface CloudVisibilityChartProps {
  cloudBaseFt: number | null
  visibilityHours: VisibilityHour[]
}

// Red-to-green ramp anchored on this app's existing status colours
// (status-bad/warn/good, already used elsewhere e.g. CompassPanel's wind
// arrow) plus two intermediate steps for the 6-band Met Office scale,
// which has no existing app-wide palette to reuse.
const CATEGORY_COLORS: Record<string, string> = {
  'Very Poor': '#ef4444',
  Poor: '#f97316',
  Moderate: '#f59e0b',
  Good: '#84cc16',
  'Very Good': '#22c55e',
  Excellent: '#10b981',
}
const CATEGORY_RANK: Record<string, number> = {
  'Very Poor': 1,
  Poor: 2,
  Moderate: 3,
  Good: 4,
  'Very Good': 5,
  Excellent: 6,
}
const MAX_CATEGORY_RANK = 6

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
const TREND_STRIP_TOP = 168
const TREND_STRIP_BOTTOM = 206
const TREND_LABEL_Y = 222

const CLOUD_ICON_COUNT = 5
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

export default function CloudVisibilityChart({ cloudBaseFt, visibilityHours }: CloudVisibilityChartProps): JSX.Element {
  const scaleMaxFt = scaleMaxFtFor(cloudBaseFt)
  const gridlines: number[] = []
  for (let ft = 0; ft <= scaleMaxFt; ft += GRIDLINE_STEP_FT) gridlines.push(ft)

  const cloudY = cloudBaseFt === null ? null : ftToY(cloudBaseFt, scaleMaxFt)
  const cloudIconXs = Array.from({ length: CLOUD_ICON_COUNT }, (_, i) => {
    const usableWidth = PLOT_RIGHT - PLOT_LEFT
    return PLOT_LEFT + (usableWidth / (CLOUD_ICON_COUNT + 1)) * (i + 1)
  })

  const trendSlotWidth = (PLOT_RIGHT - PLOT_LEFT) / Math.max(1, visibilityHours.length)
  const trendStripHeight = TREND_STRIP_BOTTOM - TREND_STRIP_TOP

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

      {/* Cloud base: a row of icons all at ONE real height, or an
          "unavailable" label - never icons at any other height, since
          there is only one real data point. */}
      {cloudY !== null ? (
        <g fontSize="20">
          {cloudIconXs.map((x, i) => (
            <text key={i} x={x} y={cloudY} textAnchor="middle" dominantBaseline="middle">
              ☁️
            </text>
          ))}
        </g>
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

      {/* Visibility trend strip - separate from the ft y-axis above (a
          distance/category, not a height), one block per upcoming hour,
          bar height proportional to category rank (taller = better). */}
      {visibilityHours.length === 0 ? (
        <text
          x={(PLOT_LEFT + PLOT_RIGHT) / 2}
          y={(TREND_STRIP_TOP + TREND_STRIP_BOTTOM) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(148, 163, 184, 0.85)"
          fontSize="11"
          fontWeight="600"
        >
          Visibility trend unavailable
        </text>
      ) : (
        visibilityHours.map((hour, i) => {
          const rank = CATEGORY_RANK[hour.category] ?? 1
          const barHeight = (rank / MAX_CATEGORY_RANK) * trendStripHeight
          const barX = PLOT_LEFT + trendSlotWidth * i + trendSlotWidth * 0.15
          const barWidth = trendSlotWidth * 0.7
          return (
            <g key={i}>
              <rect
                x={barX}
                y={TREND_STRIP_BOTTOM - barHeight}
                width={barWidth}
                height={barHeight}
                rx="2"
                fill={CATEGORY_COLORS[hour.category] ?? '#94a3b8'}
              />
              <text
                x={barX + barWidth / 2}
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
