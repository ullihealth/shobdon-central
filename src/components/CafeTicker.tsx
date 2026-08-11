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
import { weatherIconFor } from '../utils/weatherIcons'
import type { VisibilityHour } from '../services/visibilityForecastService'
import type { WeatherData } from '../types/weather'

export type TickerSlotType = 'clock' | 'forecast' | 'conditions' | 'notice' | 'fuel'

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
  // Only meaningful when type === 'notice' - WHICH specific named
  // notice this slot shows (Part C), matched against SafetyNotice.id.
  // A slot with type 'notice' and no noticeId (or one that no longer
  // matches any existing notice - e.g. it was deleted) resolves to an
  // empty segment and is skipped, same graceful-degradation posture as
  // every other empty/unset slot - never a crash.
  noticeId?: string
  // Text/Fuel rework: when true, `manualText` REPLACES whatever `type`/
  // `noticeId` would otherwise resolve to for this slot entirely - not
  // additive, an either/or (see useResolvedSegments below). Retires the
  // old `includeGasPrices` field (task #42's additive gas-prices
  // checkbox) outright - fuel prices are now their own dropdown type
  // ('fuel') instead, and this occupies the same UI position that
  // checkbox used to.
  textMode?: boolean
  // Only meaningful when textMode is true - the tenant's own typed
  // content for this slot, shown verbatim (trimmed) instead of any
  // built-in type.
  manualText?: string
  // Per-slot text colour round: independent of the whole-ticker
  // TickerStyle.fontColor below (which stays the DEFAULT every slot
  // falls back to when this is unset) - a genuinely per-slot override,
  // applying regardless of whether the slot is in textMode or showing a
  // built-in type (clock/forecast/notice/etc.), not just free-text
  // slots. #rrggbb hex, same format/validation as TickerStyle's own two
  // colour fields. Optional so slots saved before this field existed
  // still type-check and fall back to the ticker's own fontColor
  // exactly as before.
  textColor?: string
}

export interface TickerGasPrices {
  avgasPrice: number | null
  ul91Price: number | null
  jetA1Price: number | null
  currency: string
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
// export of it. id/name added for Part C's named, per-slot-selectable
// notices - both fields are always present by the time this data
// reaches the client (self-healed server-side, see ops-panel/index.ts's
// own comment), but typed optional here defensively since this
// component has no control over what publicConfig.ts actually returns.
interface SafetyNotice {
  id?: string
  name?: string
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
  gasPrices: TickerGasPrices
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

// Icons, not the text category label ("Very Good" etc.) - reuses
// weatherIconFor() from src/utils/weatherIcons.ts, the exact same
// day/night-aware icon set the main dashboard's own 6-Hour Forecast row
// (CloudVisibilityChart.tsx) already renders, per your instruction not
// to build or duplicate a second icon set. "MET OFFICE" restored in the
// label - the admin dropdown (CafeMediaPage.tsx's SLOT_TYPE_OPTIONS)
// already said "6-Hour Met Office Forecast"; this rendered text had
// drifted from it.
//
// Each hour gets its own "+N <icon>" label so it's clear which icon is
// which offset, not a bare run of symbols. Five NON-BREAKING spaces
// between groups, not five regular ones - the span this text renders
// into is `whitespace-nowrap` (CSS `white-space: nowrap`), which only
// stops wrapping, it does NOT stop the browser's normal whitespace
// COLLAPSING - a run of regular spaces would still visually collapse to
// one, silently undoing the "visible gap between hour groups" this was
// asked for.   doesn't collapse, so the gap survives.
const HOUR_GROUP_GAP = '     '

function forecastSegmentText(visibilityHours: VisibilityHour[]): string {
  if (visibilityHours.length === 0) return '6-HOUR MET OFFICE FORECAST: Unavailable'
  const groups = visibilityHours.slice(0, 6).map((hour, index) => `+${index + 1} ${weatherIconFor(hour.weatherCode, hour.isDaytime)}`)
  return `6-HOUR MET OFFICE FORECAST: ${groups.join(HOUR_GROUP_GAP)}`
}

function conditionsSegmentText(weather: WeatherData | null, liveDataUnavailable: boolean): string {
  if (!weather || liveDataUnavailable) return 'CURRENT CONDITIONS: N/A'
  const gust = weather.windGust !== undefined ? ` (gusting ${weather.windGust} kt)` : ''
  return `CURRENT CONDITIONS: ${weather.temperature}°C · Wind ${degreesToCardinal(weather.windDirection)} ${weather.windSpeed} kt${gust}`
}

// Part C: a slot with type 'notice' now references ONE specific named
// notice by id, not a blanket concatenation of every enabled notice -
// different slots can show different notices independently. Per-notice
// `enabled` still gates it (a disabled notice reads as unset here, same
// as RightInfoPanel's own NOTAM panel already treats it) - that's a
// separate, global "is this notice live at all" switch, independent of
// any individual slot's own on/off toggle.
function noticeSegmentText(noticeId: string | undefined, safetyNotices: SafetyNotice[]): string {
  if (!noticeId) return ''
  const notice = safetyNotices.find((n) => n.id === noticeId)
  if (!notice || notice.enabled === false) return ''
  return notice.text
}

// Task #42: same "LABEL: content" shape as forecastSegmentText/
// conditionsSegmentText above, so it reads consistently alongside them.
// A price of null is "not set" (Dashboard Manager's Gas Prices container
// left blank) and is simply omitted, not shown as £0.00 - same
// graceful-degradation posture as every other optional field in this
// file. Empty string (all three unset) lets the caller fall through to
// "no content" exactly like any other empty segment.
function gasPricesSegmentText(gasPrices: TickerGasPrices): string {
  const parts: string[] = []
  if (gasPrices.avgasPrice !== null) parts.push(`AVGAS ${gasPrices.currency}${gasPrices.avgasPrice.toFixed(2)}`)
  if (gasPrices.ul91Price !== null) parts.push(`UL91 ${gasPrices.currency}${gasPrices.ul91Price.toFixed(2)}`)
  if (gasPrices.jetA1Price !== null) parts.push(`JET A1 ${gasPrices.currency}${gasPrices.jetA1Price.toFixed(2)}`)
  return parts.length > 0 ? `FUEL PRICES: ${parts.join(' · ')}` : ''
}

// One resolved slot's own display text plus its own colour override (if
// any) - a slot's `position`/other identity is deliberately NOT carried
// through here (never was, even before textColor existed): several
// downstream steps (the trailing empty-segment filter, the "no content
// configured" fallback) already don't need it, and preserving position
// specifically would invite a future caller to rely on
// segments[i].position === i, which the trailing filter breaks anyway
// (a disabled/empty slot's removal shifts every later index). Colour IS
// carried through per-segment now (previously nothing but text
// survived this resolution step at all) specifically so it can reach
// renderSegments below.
interface TickerSegment {
  text: string
  color?: string
  // True only for a genuine clock segment (type === 'clock' AND not
  // textMode - see the either/or comment below). Drives tabular-nums in
  // renderSegments: the clock's digits change every second with each
  // digit's own natural (proportional) width, which otherwise makes the
  // whole segment's rendered width flicker by a few px tick-to-tick -
  // confirmed via direct offsetWidth sampling to force a real flex
  // reflow of every later sibling (worst when the clock leads, since a
  // leading slot's width change repositions the most siblings, doubled
  // by the ticker's own two-copy seamless-loop duplication). tabular-nums
  // fixes this at the source by giving every digit glyph identical
  // width, confirmed to hold the segment's own rendered width perfectly
  // constant. Scoped to just this one segment - other slot types don't
  // have a per-second-changing numeric readout, so there's no equivalent
  // problem to fix there, and tabular-nums has no visible effect on
  // non-numeric text anyway.
  isClock?: boolean
}

// Resolves each configured, ENABLED slot to its display segment - built-in
// types only, no per-slot fetching (all data is handed in as props,
// already fetched once by the parent template/preview). A disabled slot
// is skipped entirely (Part B), same as an empty/unset one - neither
// ever renders as a blank segment.
function useResolvedSegments(props: CafeTickerProps): TickerSegment[] {
  const clockText = useClockText()
  const { slots, weather, liveDataUnavailable, visibilityHours, safetyNotices, gasPrices } = props

  return slots
    .filter((slot) => slot.enabled !== false)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((slot) => {
      // Text/Fuel rework: manualText REPLACES type/noticeId entirely for
      // this slot when textMode is on - not additive, an either/or (the
      // admin UI greys out the type dropdown to match). textColor
      // applies regardless of textMode - a slot's own colour override
      // is independent of WHERE its text came from.
      const text = slot.textMode
        ? (slot.manualText ?? '').trim()
        : (() => {
            switch (slot.type) {
              case 'clock':
                return clockText
              case 'forecast':
                return forecastSegmentText(visibilityHours)
              case 'conditions':
                return conditionsSegmentText(weather, liveDataUnavailable)
              case 'notice':
                return noticeSegmentText(slot.noticeId, safetyNotices)
              case 'fuel':
                return gasPricesSegmentText(gasPrices)
              default:
                return ''
            }
          })()
      return { text, color: slot.textColor, isClock: !slot.textMode && slot.type === 'clock' }
    })
    .filter((segment) => segment.text.trim().length > 0)
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
  const content: TickerSegment[] = segments.length > 0 ? segments : [{ text: 'Ticker has no content configured yet.' }]
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

  // lineHeight: 1 (not the browser's font-dependent "normal" default,
  // ~1.15-1.2x fontSize but varies per font and isn't split evenly
  // above/below the glyphs) - Inter/Montserrat/Oswald each reserve more
  // ascent space than descent space in their own metrics, so a "normal"
  // line box centered via flex align-items below has visibly more empty
  // room above the text than below it - the reported "text sits too
  // low, bottom gets clipped" bug. Tying the line box tightly to the
  // glyphs themselves removes that asymmetric slack, so centering the
  // line box (below) actually centers the visible text.
  // No `color` here any more - it's resolved per-segment below (each
  // slot's own textColor if set, else this same style.fontColor as
  // before) - every other property still applies uniformly to every
  // segment regardless of its own colour.
  const baseTextStyle: CSSProperties = {
    fontSize: style.fontSizePx,
    lineHeight: 1,
    fontFamily: FONT_CSS_STACK[style.fontFamily],
  }

  function renderSegments(ref?: Ref<HTMLDivElement>) {
    return (
      <div ref={ref} className="flex shrink-0 items-center" style={{ gap: style.gapPx }}>
        {content.map((segment, index) => (
          <span
            key={index}
            className={`whitespace-nowrap font-semibold uppercase tracking-wide ${segment.isClock ? 'tabular-nums' : ''}`}
            style={{ ...baseTextStyle, color: segment.color || style.fontColor }}
          >
            {segment.text}
          </span>
        ))}
      </div>
    )
  }

  return (
    // Square, not rounded-xl/full-border (its look prior to the overlay
    // rework) - every caller now positions this flush against the true
    // screen edges on all three sides (left/right/bottom), where a
    // rounded corner or a border drawn right at the physical edge just
    // looks like a stray clipped line rather than a deliberate frame.
    // border-t only - still visually separates the ticker from whatever
    // panel content it now overlays above it.
    //
    // overflow-x-hidden, not overflow-hidden (both axes) - horizontal
    // clipping is still required (the marquee track below is
    // deliberately wider than this box, duplicated content for a
    // seamless loop); vertical clipping is NOT wanted here. height
    // stays a fixed style.heightPx (the tenant's own setting, unchanged)
    // so the normal case - text that actually fits - keeps centering
    // via h-full/items-center below exactly as before. But if a tenant
    // picks a Font Size (px) genuinely too large for their chosen
    // Height (px), even lineHeight:1 above can't make oversized glyphs
    // fit inside a shorter box - clipping the overflow would cut off
    // the bottom of the text; letting it render past the box's own
    // top/bottom edges instead keeps every character fully visible,
    // even though the ticker then reads as slightly taller than its own
    // configured Height for that specific combination. Every ancestor
    // wrapper (FooterTicker.tsx, CafeTemplate.tsx's inline overlay,
    // CafeMediaPage.tsx/DesignPage.tsx's preview mirrors) makes the same
    // horizontal-only overflow trade for the same reason - see each of
    // their own comments.
    <div
      className="w-full overflow-x-hidden border-t border-border"
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
