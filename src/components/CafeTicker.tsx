import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
// Same three self-hosted, OFL-1.1 @fontsource families already used by
// the Slide Editor's font picker (src/components/media/slideFonts.ts) -
// duplicated here rather than importing that file, since these CSS
// side-effect imports need to be reachable from every café-template
// tenant's main bundle (the ticker isn't behind a lazy boundary the way
// SlideEditor.tsx is), not tied to slide-composer code. @font-face
// declarations cost near-nothing on their own; the actual font FILES
// only download when the browser renders text that actually uses one
// of these families, so a Clubhouse-only tenant never fetches them.
import '@fontsource/inter/400.css'
import '@fontsource/inter/700.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/700.css'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'
import { degreesToCardinal } from '../utils/windCalculations'
import type { VisibilityHour } from '../services/visibilityForecastService'
import type { WeatherData } from '../types/weather'

export type TickerSlotType = 'clock' | 'forecast' | 'conditions' | 'notice'

export interface TickerSlot {
  position: number
  type: TickerSlotType | null
  // Independent of `type` - Part B: a slot can have a type picked but
  // still be switched off, mirroring ops_panel_state's safetyNotices
  // `{enabled}` pattern exactly. Optional so slots saved before this
  // field existed still type-check; useResolvedSegments below treats a
  // missing value as enabled (same `!== false` convention safetyNotices
  // itself already uses).
  enabled?: boolean
}

export interface TickerStyle {
  backgroundColor: string
  // 0-100
  backgroundOpacity: number
  heightPx: number
  fontFamily: 'Inter' | 'Montserrat' | 'Oswald'
  fontSizePx: number
  fontColor: string
  // px/second the content scrolls at. 0 (or below) is a deliberate,
  // valid value - static, no animation, no duplicated track - not an
  // unset placeholder. Sufficient stand-in for a separate "static mode"
  // toggle, confirmed against your own live feedback.
  scrollSpeedPxPerSec: number
  // Horizontal space between consecutive ticker items, applied
  // uniformly everywhere (between items within one content pass AND
  // at the wrap-around point between the last item and the repeat) -
  // 0 is today's default (tight). Large enough and a message can fully
  // scroll off-screen before the next one appears, which is a valid,
  // intentional look, not a bug.
  gapPx: number
}

const FONT_CSS_STACK: Record<TickerStyle['fontFamily'], string> = {
  Inter: 'Inter, sans-serif',
  Montserrat: 'Montserrat, sans-serif',
  Oswald: 'Oswald, sans-serif',
}

// Duplicated locally rather than imported - RightInfoPanel.tsx/
// AtcControlPage.tsx already each keep their own private copy of this
// exact shape (see Part A investigation); this follows the same
// pre-existing convention rather than introducing the first shared
// export of it.
interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

interface CafeTickerProps {
  slots: TickerSlot[]
  weather: WeatherData | null
  liveDataUnavailable: boolean
  visibilityHours: VisibilityHour[]
  safetyNotices: SafetyNotice[]
  style: TickerStyle
}

function useClockText(): string {
  const [now, setNow] = useState(new Date())
  useLayoutEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const date = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: AIRFIELD_TIMEZONE })
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: AIRFIELD_TIMEZONE })
  return `${date} — ${time}`
}

function forecastSegmentText(visibilityHours: VisibilityHour[]): string {
  if (visibilityHours.length === 0) return '6-HOUR FORECAST: Unavailable'
  const parts = visibilityHours.slice(0, 6).map((hour, index) => `+${index + 1}h ${hour.category}`)
  return `6-HOUR FORECAST: ${parts.join(' · ')}`
}

function conditionsSegmentText(weather: WeatherData | null, liveDataUnavailable: boolean): string {
  if (!weather || liveDataUnavailable) return 'CURRENT CONDITIONS: N/A'
  const gust = weather.windGust !== undefined ? ` (gusting ${weather.windGust} kt)` : ''
  return `CURRENT CONDITIONS: ${weather.temperature}°C · Wind ${degreesToCardinal(weather.windDirection)} ${weather.windSpeed} kt${gust}`
}

function noticeSegmentText(safetyNotices: SafetyNotice[]): string {
  const enabled = safetyNotices.filter((notice) => notice.enabled !== false)
  if (enabled.length === 0) return ''
  return enabled.map((notice) => notice.text).join('   •   ')
}

// Resolves each configured, ENABLED slot to its display text - built-in
// types only, no per-slot fetching (all data is handed in as props,
// already fetched once by the parent template/preview). A disabled slot
// is skipped entirely (Part B), same as an empty/unset one - neither
// ever renders as a blank segment.
function useResolvedSegments(props: CafeTickerProps): string[] {
  const clockText = useClockText()
  const { slots, weather, liveDataUnavailable, visibilityHours, safetyNotices } = props

  return slots
    .filter((slot) => slot.enabled !== false)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((slot) => {
      switch (slot.type) {
        case 'clock':
          return clockText
        case 'forecast':
          return forecastSegmentText(visibilityHours)
        case 'conditions':
          return conditionsSegmentText(weather, liveDataUnavailable)
        case 'notice':
          return noticeSegmentText(safetyNotices)
        default:
          return ''
      }
    })
    .filter((text) => text.trim().length > 0)
}

function hexToRgba(hex: string, opacityPercent: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return hex
  const value = match[1]
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const a = Math.max(0, Math.min(100, opacityPercent)) / 100
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

// Full-width, continuous horizontal scroll - a seamless, looping marquee,
// deliberately not the discrete dwell-per-slide pattern used everywhere
// else in this codebase (MediaPanel's carousel, LeftInfoPanel/
// RightInfoPanel's A/B flips). The segment list is rendered TWICE
// back-to-back in one continuous flex row; the --cafe-ticker-distance
// custom property (see index.css) tells the always-present `cafe-ticker`
// keyframe exactly how many pixels to translate per loop - the measured
// width of one copy (gaps included) plus the wrap-around gap to the
// second copy - so the loop point is invisible regardless of gap size.
// speed <= 0 skips all animation - a single, non-duplicated, static
// copy of the content is shown instead.
export default function CafeTicker(props: CafeTickerProps): JSX.Element {
  const segments = useResolvedSegments(props)
  const content = segments.length > 0 ? segments : ['Ticker has no content configured yet.']
  const { style } = props
  const isStatic = style.scrollSpeedPxPerSec <= 0

  const measureRef = useRef<HTMLDivElement>(null)
  const [anim, setAnim] = useState({ durationSeconds: 30, distancePx: 0 })

  // Deliberately does NOT depend on `content` (the resolved segment
  // TEXT). A live clock slot changes that text every second, which
  // used to sit in this effect's dependency array and retrigger the
  // whole thing - tearing down and recreating the ResizeObserver and
  // synchronously remeasuring on a ~1s cadence. Each remeasurement
  // produced a fresh (often sub-pixel-different, due to
  // getBoundingClientRect() rounding) duration/distance, which got
  // reapplied to the CSS animation via animationDuration and the
  // --cafe-ticker-distance custom property below - and changing either
  // of those on an ALREADY-RUNNING animation makes the browser
  // reinterpret its timeline against elapsed real time, producing a
  // visible jump. That's the periodic stutter that was reported.
  //
  // The fix has two parts: (1) this effect only re-runs, and the
  // ResizeObserver only gets torn down/recreated, when something that
  // genuinely changes layout inputs changes - isStatic, speed, or gap -
  // never on a mere content-text change. (2) the ResizeObserver itself
  // stays attached across content updates (React reuses the same DOM
  // node via `measureRef`, it never remounts just because a clock tick
  // changed a <span>'s text), so it still naturally fires when content
  // genuinely resizes the track (a slot added/removed, a notice/weather
  // string changing length) - but the resulting measurement is only
  // applied via setAnim if it differs from the last APPLIED value by
  // more than 1%, filtering out the sub-pixel noise a ticking clock
  // produces without ever suppressing a real content-driven resize.
  useLayoutEffect(() => {
    if (isStatic || !measureRef.current) return
    const el = measureRef.current
    let lastDistance: number | null = null
    const measure = () => {
      const copyWidth = el.getBoundingClientRect().width
      if (copyWidth <= 0) return
      // One copy's own rendered width already includes the gaps
      // BETWEEN its items (CSS `gap` on that flex container, below) -
      // adding one more gapPx accounts for the wrap-around gap between
      // this copy's last item and the next copy's first.
      const distance = copyWidth + style.gapPx
      if (lastDistance !== null && Math.abs(distance - lastDistance) / lastDistance <= 0.01) return
      lastDistance = distance
      setAnim({ durationSeconds: distance / style.scrollSpeedPxPerSec, distancePx: distance })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [isStatic, style.scrollSpeedPxPerSec, style.gapPx])

  const textStyle: CSSProperties = {
    fontSize: style.fontSizePx,
    color: style.fontColor,
    fontFamily: FONT_CSS_STACK[style.fontFamily],
  }

  function renderSegments(ref?: Ref<HTMLDivElement>) {
    return (
      <div ref={ref} className="flex shrink-0 items-center" style={{ gap: style.gapPx }}>
        {content.map((text, index) => (
          <span key={index} className="whitespace-nowrap font-semibold uppercase tracking-wide" style={textStyle}>
            {text}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div
      className="w-full overflow-hidden rounded-xl border border-border"
      style={{ height: style.heightPx, backgroundColor: hexToRgba(style.backgroundColor, style.backgroundOpacity) }}
    >
      {isStatic ? (
        <div className="flex h-full w-full items-center overflow-hidden">{renderSegments(measureRef)}</div>
      ) : (
        <div
          className="flex h-full w-max items-center"
          style={
            {
              gap: style.gapPx,
              animationName: 'cafe-ticker',
              animationTimingFunction: 'linear',
              animationIterationCount: 'infinite',
              animationDuration: `${anim.durationSeconds}s`,
              '--cafe-ticker-distance': `${anim.distancePx}px`,
            } as CSSProperties
          }
        >
          {renderSegments(measureRef)}
          {renderSegments()}
        </div>
      )}
    </div>
  )
}
