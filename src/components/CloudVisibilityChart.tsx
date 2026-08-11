import { useEffect, useRef, useState } from 'react'
import type { VisibilityHour } from '../services/visibilityForecastService'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'
import { weatherIconFor } from '../utils/weatherIcons'

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
  // Pilot View mobile round: this card renders noticeably larger on a
  // real phone than the TV dashboard's sizes were ever tuned for (see
  // PLOT_LEFT_DEFAULT's own comment on how sensitive those sizes are to the
  // TV/kiosk viewport specifically). Opt-in only - LeftInfoPanel.tsx and
  // Clubhouse2Template.tsx (both TV dashboard callers) omit this and
  // keep their exact existing sizing untouched; ForecastCloudbaseCluster
  // (the /pilot caller) is the only one that passes it.
  largeText?: boolean
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

// How often the "+Nh" labels below re-derive from the real clock - see
// anchorIndexFor's own comment for why this exists at all. 1 minute, not
// Header.tsx's 1-second clock tick: these labels round to whole hours,
// so nothing they'd display can change faster than that; a slower tick
// is just cheaper for the same visible result.
const LABEL_TICK_MS = 60 * 1000
const MS_PER_HOUR = 60 * 60 * 1000
// "Now" through "+5h" - the strip's own fixed, always-6 shape (see
// displayHours' own comment for why the backend fetches one more than
// this).
const MAX_DISPLAY_HOURS = 6

// Round 2 of this same bug, traced live rather than just re-labelled:
// the PREVIOUS version (`Math.round((forecast - now) / 1h)`, "Now" for
// anything <= 0) computed each hour's label independently, and that
// independence was the actual defect. This route's cache can
// legitimately go on serving an entry that's already up to 59 minutes
// old (pickUpcomingHours only filters "upcoming" once, at fetch time,
// against a 60-minute KV TTL - see publicVisibilityForecast.ts) - once
// real elapsed time pushed that first entry's raw delta past -30
// minutes, Math.round sent it to -1, which the old `<= 0` check still
// called "Now" (it never distinguished "-1h, already elapsed" from "0h,
// current" - both were the same bucket). At the exact same moment the
// NEXT hourly entry (exactly 60 minutes later by construction) had its
// own raw delta cross +30 minutes, which Math.round also sends to 0 -
// "Now" again. Two independent roundings, two "Now"s, and every label
// after them one hour behind where it should read. A same-shape fix
// that instead floors to calendar-hour buckets was tried and rejected
// once actually traced against this route's real data: it stopped the
// collision, but the fetch-time-only filter means the closest entry the
// cache holds is very often already MORE than an hour out (Met Office's
// hourly steps land on the following full hour boundary, not "however
// much of the current hour remains"), so most of the time no entry ever
// rounds to "Now" at all - "+1h, +2h, ... +6h" with no anchor, not the
// attached Met Office SAWS reference's "Now, +1h, ..., +5h".
//
// Fixed by treating the array as one ordered sequence instead of six
// independent lookups: find the LATEST entry whose raw delta still
// rounds to <= 0 (the true current anchor - any earlier entry sharing
// that bucket is stale, already superseded, and dropped rather than
// mislabelled); if none does (the fresh-cache case above), the nearest
// upcoming entry becomes the anchor by definition, same as the SAWS
// reference's own "Now" evidently means "nearest available step", not
// "occurring this exact instant". Every entry from the anchor onward is
// then labelled purely by its position after it (Now, +1h, +2h...), not
// by re-deriving its own delta - correct because Met Office's hourly
// steps are always genuinely one hour apart, so position alone is
// exactly right once the anchor is, and two entries can never again
// collide on the same label.
function anchorIndexFor(hoursArr: VisibilityHour[], nowMs: number): number {
  let anchor = 0
  for (let i = 0; i < hoursArr.length; i += 1) {
    const deltaHours = Math.round((Date.parse(hoursArr[i].forecastForUtc) - nowMs) / MS_PER_HOUR)
    if (deltaHours <= 0) anchor = i
  }
  return anchor
}

function hourLabelForIndex(indexAfterAnchor: number): string {
  return indexAfterAnchor === 0 ? 'Now' : `+${indexAfterAnchor}h`
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
// Round 2 of this same tuning: reported as "still small" on BOTH
// surfaces (the TV dashboard was never touched by the first largeText-
// only pass - LeftInfoPanel.tsx/Clubhouse2Template.tsx pass nothing, so
// they kept the original fontSize="8"/PLOT_LEFT_DEFAULT=36 the whole
// time). AXIS_FONT_SIZE_DEFAULT/_LARGE and their matching PLOT_LEFT_*
// margins below are both now meaningfully larger on EVERY caller, not
// just /pilot - verified via real rendered bounding-box height on both
// an iPhone viewport (/pilot) and a real desktop viewport (/), not
// assumed from the SVG unit numbers alone (which don't map 1:1 to
// screen px - see VIEW_HEIGHT's own comment on the "meet" scale
// factor).
const AXIS_FONT_SIZE_DEFAULT = '12'
const AXIS_FONT_SIZE_LARGE = '22'
// /pilot-only brightness bump (SVG fill, not a Tailwind class - this
// text lives inside the <svg>) - rgba(148, 163, 184, ...) is
// text-muted-400's own colour value at 0.85 opacity; the TV dashboard
// keeps that exact value unchanged. AXIS_FILL_LARGE is text-muted-300's
// colour (#cbd5e1) at full opacity - a real, visible step up, not just
// removing the transparency on the same colour.
const AXIS_FILL_DEFAULT = 'rgba(148, 163, 184, 0.85)'
const AXIS_FILL_LARGE = '#cbd5e1'
const PLOT_LEFT_DEFAULT = 52
// Matching left-margin increase for AXIS_FONT_SIZE_LARGE - without this
// the wider glyphs simply clip off the SVG viewBox's own left edge
// (confirmed last round: "6000ft" rendered as "00ft" at too narrow a
// margin). Not a naive proportional scale-up of PLOT_LEFT_DEFAULT -
// measured empirically against the actual rendered "0000ft" text width
// at this font size.
const PLOT_LEFT_LARGE = 96
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

export default function CloudVisibilityChart({
  cloudBaseFt,
  cloudBaseCapturedAt,
  visibilityHours,
  visibilityFetchedAt,
  largeText = false,
}: CloudVisibilityChartProps): JSX.Element {
  // Tracks the plot SVG's own real rendered box so viewWidth (and
  // everything derived from it below) always matches the box's actual
  // aspect ratio - see the VIEW_HEIGHT comment above for why this
  // replaced a fixed-ratio viewBox.
  const plotWrapperRef = useRef<HTMLDivElement>(null)
  const [viewWidth, setViewWidth] = useState(FALLBACK_VIEW_WIDTH)

  // See anchorIndexFor's own comment - ticks independently of
  // visibilityHours (which only changes every 15 minutes, or whenever
  // the server-side cache refreshes) so the labels keep correcting
  // themselves against the real clock in between.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), LABEL_TICK_MS)
    return () => window.clearInterval(interval)
  }, [])

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
  const plotLeft = largeText ? PLOT_LEFT_LARGE : PLOT_LEFT_DEFAULT

  // See anchorIndexFor's own comment - the 6-Hour Forecast strip below
  // renders this sliced/anchored array, not visibilityHours directly, so
  // its labels are never computed per-entry independently again. Capped
  // at MAX_DISPLAY_HOURS (not just sliced from the anchor onward) so a
  // freshly-fetched, not-yet-stale cache - which now holds
  // FORECAST_HOUR_COUNT=7 entries, one deliberate buffer hour past what
  // this strip ever shows, see that constant's own comment - never
  // displays a 7th icon; the buffer exists purely so that when the
  // anchor DOES drop one superseded entry, 6 real ones are still left,
  // not 5.
  const anchorIndex = anchorIndexFor(visibilityHours, nowMs)
  const displayHours = visibilityHours.slice(anchorIndex, anchorIndex + MAX_DISPLAY_HOURS)

  const scaleMaxFt = scaleMaxFtFor(cloudBaseFt)
  const gridlines: number[] = []
  for (let ft = 0; ft <= scaleMaxFt; ft += GRIDLINE_STEP_FT) gridlines.push(ft)

  const cloudY = cloudBaseFt === null ? null : ftToY(cloudBaseFt, scaleMaxFt)
  const iconStyle = VISIBILITY_ICON_STYLE[visibilityHours[0]?.category ?? ''] ?? DEFAULT_ICON_STYLE
  const usableWidth = plotRight - plotLeft
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
    return plotLeft + spacing * (i + 1)
  })

  return (
    // Two genuinely separate card containers (not one shared block with
    // an internal divider) - same rounded-2xl/border/bg-card styling as
    // the Ceiling/Visibility callouts above them, stacked with a real
    // gap between.
    <div className="flex h-full flex-col gap-2">
      <div className="flex min-h-0 flex-[2] flex-col rounded-2xl border border-border bg-card p-4">
        <div className={`mb-2 flex-shrink-0 text-center text-sm font-bold uppercase tracking-widest ${largeText ? 'text-muted-300' : 'text-muted-500'}`}>
          Calculated Convected Cloud Base
        </div>
        <div ref={plotWrapperRef} className="min-h-0 flex-1">
          <svg viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
            {/* Gridlines + full aviation-style ft labels - "1000ft", not
                the abbreviated "1k" this started with, so it reads
                unambiguously as altitude data. */}
            <g stroke="rgba(148, 163, 184, 0.25)" strokeWidth="1">
              {gridlines.map((ft) => (
                <line key={ft} x1={plotLeft} y1={ftToY(ft, scaleMaxFt)} x2={plotRight} y2={ftToY(ft, scaleMaxFt)} />
              ))}
            </g>
            {/* Deliberately no longer required to stay under the card
                title's own size (that constraint was this comment's
                original reasoning, before this round's explicit request
                to make these numbers bigger, full stop, on both
                surfaces) - picked by direct measurement of the real
                rendered result, not the SVG unit number alone: the
                "meet" scale factor that converts these SVG units to
                real screen pixels varies a LOT by viewport (measured
                0.5x at 1366x768 up to 1.83x at 1920x1080 for this
                card's real proportions), so a value that looks right on
                one screen can render very differently on another -
                verified against both a real iPhone viewport and a real
                1920x1080 desktop viewport, not just one screenshot. */}
            <g fill={largeText ? AXIS_FILL_LARGE : AXIS_FILL_DEFAULT} fontSize={largeText ? AXIS_FONT_SIZE_LARGE : AXIS_FONT_SIZE_DEFAULT} fontWeight="600">
              {gridlines.map((ft) => (
                <text key={ft} x={plotLeft - 4} y={ftToY(ft, scaleMaxFt)} textAnchor="end" dominantBaseline="middle">
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
                x={(plotLeft + plotRight) / 2}
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
          <div className={`mt-1 flex-shrink-0 text-center ${largeText ? 'text-sm text-muted-300' : 'text-[0.625rem] text-muted-500'}`}>
            Last updated {formatTime(cloudBaseCapturedAt)}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 rounded-2xl border border-border bg-card p-4">
        <div className={`mb-4 text-center font-bold uppercase tracking-widest text-muted-500 ${largeText ? 'text-lg' : 'text-sm'}`}>
          6-Hour Forecast
        </div>
        {/* Plain HTML, not SVG, deliberately - a flow-layout emoji glyph
            is sized by font-size alone and can never be non-uniformly
            stretched the way an SVG scaled to fill an arbitrary box can
            be. Visibility itself isn't shown here at all (see the
            cluster above) - this row is weather TYPE only. */}
        {displayHours.length === 0 ? (
          <div className="py-2 text-center text-xs font-semibold text-muted-500">Weather trend unavailable</div>
        ) : (
          <div className="flex items-start justify-around">
            {displayHours.map((hour, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className={`leading-none ${largeText ? 'text-4xl' : 'text-xl'}`}>{weatherIconFor(hour.weatherCode, hour.isDaytime)}</span>
                <span className={`mt-1.5 font-semibold ${largeText ? 'text-base text-muted-300' : 'text-xs text-muted-500'}`}>{hourLabelForIndex(i)}</span>
              </div>
            ))}
          </div>
        )}
        {visibilityFetchedAt && (
          // Names the specific product/source, not just a bare "Last
          // updated" stamp - found investigating a reported discrepancy
          // against weather.metoffice.gov.uk that this widget's own
          // Met Office DataHub product (Global Spot) can genuinely
          // diverge from the consumer website's own forecast for the
          // same hours, since neither is guaranteed to be the other's
          // source. A pilot comparing the two should read this as its
          // own distinct, clearly-sourced data point, not as this app
          // disagreeing with "the" Met Office.
          <div className="mt-5 text-center text-[0.625rem] text-muted-500">
            Met Office DataHub · updated {formatTime(visibilityFetchedAt)}
          </div>
        )}
      </div>
    </div>
  )
}
