import { useEffect, useState } from 'react'
import { AIRFIELD_TIMEZONE } from '../config/publicApi'
import { degreesToCardinal } from '../utils/windCalculations'
import type { VisibilityHour } from '../services/visibilityForecastService'
import type { WeatherData } from '../types/weather'

export type TickerSlotType = 'clock' | 'forecast' | 'conditions' | 'notice'

export interface TickerSlot {
  position: number
  type: TickerSlotType | null
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
}

function useClockText(): string {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
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

// Resolves each configured slot to its display text - built-in types only,
// no per-slot fetching (all data is handed in as props, already fetched
// once by the parent template/preview). Empty/unset slots are skipped
// entirely, not rendered as a blank segment.
function useResolvedSegments(props: CafeTickerProps): string[] {
  const clockText = useClockText()
  const { slots, weather, liveDataUnavailable, visibilityHours, safetyNotices } = props

  return slots
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

// Full-width, continuous horizontal scroll - a seamless, looping marquee,
// deliberately not the discrete dwell-per-slide pattern used everywhere
// else in this codebase (MediaPanel's carousel, LeftInfoPanel/
// RightInfoPanel's A/B flips). No existing marquee/ticker precedent
// exists anywhere in this repo (confirmed by investigation) - built from
// scratch via the scroll-left keyframe registered in tailwind.config.cjs.
// The segment list is rendered TWICE back-to-back in one continuous flex
// row, then translated exactly -50% - since both halves are identical,
// the loop point is invisible.
export default function CafeTicker(props: CafeTickerProps): JSX.Element {
  const segments = useResolvedSegments(props)
  const content = segments.length > 0 ? segments : ['Ticker has no content configured yet.']

  const track = (
    <div className="flex shrink-0 items-center">
      {content.map((text, index) => (
        <span key={index} className="whitespace-nowrap px-8 text-base font-semibold uppercase tracking-wide text-primary">
          {text}
        </span>
      ))}
    </div>
  )

  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-border bg-panel">
      <div className="flex h-full w-max animate-cafe-ticker items-center">
        {track}
        {track}
      </div>
    </div>
  )
}
