import { useEffect, useRef, useState } from 'react'
import type { VisibilityHour } from '../services/visibilityForecastService'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'

interface CloudVisibilityChartProps {
  cloudBaseFt: number | null
  // ISO timestamp of the ATC station reading cloudBaseFt was calculated
  // from - null whenever cloudBaseFt itself is null, same gate, so this
  // is never a freshness claim about data that isn't actually shown.
  cloudBaseCapturedAt: string | null
  visibilityHours: VisibilityHour[]
  // ISO timestamp of when the Met Office forecast was actually fetched
  // (server-side, then cached) - null whenever visibilityHours is empty.
  visibilityFetchedAt: string | null
}

// Same "Last updated HH:MM" formatting Header.tsx already uses for the
// main dashboard clock - reused here for consistency, though unlike that
// display (which just ticks with the current time every second) these
// two values are genuine data-freshness timestamps: an ATC capture time
// and a Met Office fetch time, not the current render time. timeZone:
// AIRFIELD_TIMEZONE, not the viewing device's own local zone - a "Last
// updated" stamp is meaningless if it silently shifts with whatever
// timezone the browser/TV happens to be set to.
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: AIRFIELD_TIMEZONE })
}

// Previously a FIXED viewBox (220x300, a portrait ratio picked as "close
// to the middle of the real observed range" across a handful of measured
// resolutions) uniformly scaled via preserveAspectRatio="xMidYMid meet".
// That's inherently unfixable by construction: any card aspect ratio
// outside whatever range was "observed" when the ratio was picked still
// mismatches "meet"'s own viewBox, and letterboxes worse the further the
// real box diverges from the guess - confirmed directly: a non-4K TV
// still showed a squashed plot even after the one already-known 4K-
// specific cause (DashboardPage's since-removed max-w-[1920px] cap) was
// fixed, because THIS card's real aspect ratio simply falls outside the
// range 220x300 was tuned against. VIEW_WIDTH is now measured from the
// SVG's actual rendered box (see plotWrapperRef/ResizeObserver below) and
// kept in sync with it, so the viewBox's ratio always exactly matches the
// real box - "meet" then never has anything to letterbox, at any
// resolution or aspect ratio, without needing to know it in advance.
// VIEW_HEIGHT stays fixed - it's the coordinate system's vertical scale,
// what every ft-to-pixel calculation below is built around - only the
// width side needs to track the real box.
const VIEW_HEIGHT = 300
// Used for exactly one render, before ResizeObserver reports the real
// box - replaced immediately after, so its own value barely matters as
// long as it's a reasonable placeholder that doesn't visibly flash.
const FALLBACK_VIEW_WIDTH = 220
// 92 (an earlier value) over-corrected for the font-size-doubling round
// below it undoes: labels ended up both larger than the card's own
// "Cloud Base Forecast" title AND floating in from the left edge with a
// large unused gap. Pulled back down close to comfortable-padding-only
// alongside the smaller font size - verified empirically (real gap from
// card edge to label, real gap from label to gridline) rather than
// computed from the font-size change alone. Fixed, not width-relative -
// it's sized to comfortably fit the "0000ft" label text at the font size
// below, which doesn't itself change with the box's aspect ratio.
const PLOT_LEFT = 36
const PLOT_TOP = 20
const HEIGHT_SCALE_BOTTOM = 280

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

// Previously collapsed every day/night-paired code to one glyph each
// (the comment here used to read "this dashboard doesn't need night/day
// to render differently") - that's what showed a sun icon for +3h..+6h
// on a 19:39 BST evening in July: code 0 ("Clear night") and code 1
// ("Sunny day") both rendered as ☀️, discarding the night/day
// distinction Met Office's Significant Weather Code already encodes
// directly in the code value itself, computed server-side from
// Shobdon's real coordinates against genuine sunrise/sunset - not from
// any client clock, so there's no timezone dependency to get right here
// at all; using the code as-is is correct on any viewing device
// regardless of its own system clock/timezone (verified by testing with
// the browser's own timezone changed - the icons don't move, because
// they never depended on it to begin with). Only clear/partly-cloudy
// have a day/night pair worth distinguishing visually (0/1, 2/3) -
// every other pair (e.g. 28/29, confirmed against the official Met
// Office DataPoint code-definitions reference) still renders one glyph
// per weather TYPE regardless of time, same as before; rain looks like
// rain whether it's 2pm or 2am.
function weatherIconFor(code: number | undefined): string {
  if (code === undefined) return '–'
  switch (code) {
    case 0: return '🌙' // Clear night
    case 1: return '☀️' // Sunny day
    case 2: return '🌙' // Partly cloudy (night)
    case 3: return '⛅' // Partly cloudy (day)
    case 5: return '🌫️' // Mist
    case 6: return '🌫️' // Fog
    case 7: return '🌥️' // Cloudy
    case 8: return '☁️' // Overcast
    default: break
  }
  if (code >= 9 && code <= 15) return '🌧️' // Drizzle / rain, light-heavy (no day/night pair)
  if (code >= 16 && code <= 21) return '🧊' // Sleet / hail (no day/night pair)
  if (code >= 22 && code <= 27) return '❄️' // Snow (no day/night pair)
  if (code >= 28 && code <= 30) return '⛈️' // Thunder (no day/night pair)
  return '❓' // Unmapped (e.g. code 4, not used by the API)
}

export default function CloudVisibilityChart({
  cloudBaseFt,
  cloudBaseCapturedAt,
  visibilityHours,
  visibilityFetchedAt,
}: CloudVisibilityChartProps): JSX.Element {
  // Tracks the plot SVG's own real rendered box so viewWidth (and
  // everything derived from it below) always matches the box's actual
  // aspect ratio - see the VIEW_HEIGHT comment above for why this
  // replaced a fixed-ratio viewBox.
  const plotWrapperRef = useRef<HTMLDivElement>(null)
  const [viewWidth, setViewWidth] = useState(FALLBACK_VIEW_WIDTH)

  useEffect(() => {
    const el = plotWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setViewWidth((VIEW_HEIGHT * width) / height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotRight = viewWidth - 10

  const scaleMaxFt = scaleMaxFtFor(cloudBaseFt)
  const gridlines: number[] = []
  for (let ft = 0; ft <= scaleMaxFt; ft += GRIDLINE_STEP_FT) gridlines.push(ft)

  const cloudY = cloudBaseFt === null ? null : ftToY(cloudBaseFt, scaleMaxFt)
  const iconStyle = VISIBILITY_ICON_STYLE[visibilityHours[0]?.category ?? ''] ?? DEFAULT_ICON_STYLE
  const usableWidth = plotRight - PLOT_LEFT
  // Shrinks as count grows (1 icon at count=1 up to 11 at Very Poor) so
  // the densest case never overlaps - capped at 22 so the sparse cases
  // (1-3 icons) don't blow up into oversized shapes. The 0.9 factor is a
  // real fix, not a fudge: CloudIcon's outer lobes extend to about 1.05x
  // the nominal `size` (their centres sit at 0.55r either side of cx,
  // each with its own 0.5r radius), so icons spaced exactly `size` apart
  // measurably overlapped by ~1-2px at every tested count when sized at
  // the full available spacing - caught by directly measuring the real
  // gap between adjacent rendered icons, not assumed from the spacing
  // formula alone.
  const cloudIconSize = Math.min(22, (usableWidth / (iconStyle.count + 1)) * 0.9)
  const cloudIconXs = Array.from({ length: iconStyle.count }, (_, i) => {
    const spacing = usableWidth / (iconStyle.count + 1)
    return PLOT_LEFT + spacing * (i + 1)
  })

  return (
    // Two genuinely separate card containers (not one shared block with
    // an internal divider) - same rounded-2xl/border/bg-card styling as
    // the Ceiling/Visibility callouts above them, stacked with a real
    // gap between.
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-h-0 flex-[2] flex-col rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex-shrink-0 text-center text-sm font-bold uppercase tracking-widest text-muted-500">
          Cloud Base Forecast
        </div>
        <div ref={plotWrapperRef} className="min-h-0 flex-1">
          <svg viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
            {/* Gridlines + full aviation-style ft labels - "1000ft", not
                the abbreviated "1k" this started with, so it reads
                unambiguously as altitude data. */}
            <g stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
              {gridlines.map((ft) => (
                <line key={ft} x1={PLOT_LEFT} y1={ftToY(ft, scaleMaxFt)} x2={plotRight} y2={ftToY(ft, scaleMaxFt)} />
              ))}
            </g>
            {/* fontSize deliberately well under the card title's real
                rendered size (text-sm/14px in plain CSS) - the title
                must stay the most prominent text on the card. Picked by
                direct measurement, not just the number itself: the
                "meet" scale factor that converts these SVG units to
                real pixels varies a LOT by viewport (measured 0.5x at
                1366x768 up to 1.83x at 1920x1080 for this card's real
                proportions), so a value that looks right on one screen
                can render nearly 4x bigger on another - this needed to
                stay small enough to beat the title's real height even
                at the largest observed scale factor, not just the
                screen a single screenshot happened to be taken on. */}
            <g fill="rgba(148, 163, 184, 0.85)" fontSize="8" fontWeight="600">
              {gridlines.map((ft) => (
                <text key={ft} x={PLOT_LEFT - 4} y={ftToY(ft, scaleMaxFt)} textAnchor="end" dominantBaseline="middle">
                  {ft}ft
                </text>
              ))}
            </g>

            {/* Current-conditions cloud cluster: a row of icons all at
                ONE real height (Shobdon's calculated Cloud Base) - never
                at any other height, since there is only one real data
                point. Icon COUNT and COLOUR encode the current hour's
                real visibility category. */}
            {cloudY !== null ? (
              cloudIconXs.map((x, i) => (
                <CloudIcon key={i} cx={x} cy={cloudY} size={cloudIconSize} fill={iconStyle.color} />
              ))
            ) : (
              <text
                x={(PLOT_LEFT + plotRight) / 2}
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
          </svg>
        </div>
        {cloudBaseCapturedAt && (
          <div className="mt-1 flex-shrink-0 text-center text-[0.625rem] text-muted-500">
            Last updated {formatTime(cloudBaseCapturedAt)}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 rounded-2xl border border-border bg-card p-4">
        <div className="mb-4 text-center text-sm font-bold uppercase tracking-widest text-muted-500">
          6-Hour Forecast
        </div>
        {/* Plain HTML, not SVG, deliberately - a flow-layout emoji glyph
            is sized by font-size alone and can never be non-uniformly
            stretched the way an SVG scaled to fill an arbitrary box can
            be. Visibility itself isn't shown here at all (see the
            cluster above) - this row is weather TYPE only. */}
        {visibilityHours.length === 0 ? (
          <div className="py-2 text-center text-xs font-semibold text-muted-500">Weather trend unavailable</div>
        ) : (
          <div className="flex items-start justify-around">
            {visibilityHours.map((hour, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="text-xl leading-none">{weatherIconFor(hour.weatherCode)}</span>
                <span className="mt-1.5 text-xs font-semibold text-muted-500">+{i + 1}h</span>
              </div>
            ))}
          </div>
        )}
        {visibilityFetchedAt && (
          <div className="mt-5 text-center text-[0.625rem] text-muted-500">Last updated {formatTime(visibilityFetchedAt)}</div>
        )}
      </div>
    </div>
  )
}
