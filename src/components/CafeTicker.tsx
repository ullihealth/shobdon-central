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
// back-to-back in one continuous flex row, then translated exactly
// -50% via the always-present `cafe-ticker` keyframe (index.css) - since
// both halves are identical, the loop point is invisible. Scroll speed
// is genuinely px/second, not a fixed duration: the first copy's
// rendered width is measured (ResizeObserver, re-measures if content or
// speed changes) and converted to a duration in seconds, applied via
// inline animation-duration. speed <= 0 skips all of this - a single,
// non-duplicated, non-animated copy of the content is shown instead.
export default function CafeTicker(props: CafeTickerProps): JSX.Element {
  const segments = useResolvedSegments(props)
  const content = segments.length > 0 ? segments : ['Ticker has no content configured yet.']
  const { style } = props
  const isStatic = style.scrollSpeedPxPerSec <= 0

  const measureRef = useRef<HTMLDivElement>(null)
  const [durationSeconds, setDurationSeconds] = useState(30)

  useLayoutEffect(() => {
    if (isStatic || !measureRef.current) return
    const el = measureRef.current
    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (width > 0) setDurationSeconds(width / style.scrollSpeedPxPerSec)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [isStatic, style.scrollSpeedPxPerSec, content.join(' ')])

  const textStyle: CSSProperties = {
    fontSize: style.fontSizePx,
    color: style.fontColor,
    fontFamily: FONT_CSS_STACK[style.fontFamily],
  }

  function renderSegments(ref?: Ref<HTMLDivElement>) {
    return (
      <div ref={ref} className="flex shrink-0 items-center">
        {content.map((text, index) => (
          <span key={index} className="whitespace-nowrap px-8 font-semibold uppercase tracking-wide" style={textStyle}>
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
          style={{
            animationName: 'cafe-ticker',
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
            animationDuration: `${durationSeconds}s`,
          }}
        >
          {renderSegments(measureRef)}
          {renderSegments()}
        </div>
      )}
    </div>
  )
}
