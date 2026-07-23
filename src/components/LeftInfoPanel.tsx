import { useEffect, useRef, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { degreesToCardinal } from '../utils/windCalculations'
import { estimateCloudBaseFt } from '../utils/cloudBase'
import { useVisibilityForecast } from '../services/visibilityForecastService'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import CloudVisibilityChart from './CloudVisibilityChart'

export interface OpsPanelChartConfig {
  weatherSummaryChartEnabled: boolean
  weatherSummaryStateADurationSeconds: number
  weatherSummaryStateBDurationSeconds: number
}

// Local to these stat cards, decoupled from the global root clamp() in
// index.css (same pattern as CompassPanel's ReadoutRow in b75c77e) - that
// scale also drives the header clock, media banners, and notice boards,
// none of which this adjustment is meant to touch. Label and value get
// separate clamp()s, not the same size scaled down together: a label
// that wraps to two lines (e.g. "CLOUD BASE (SHOBDON CALCULATED)") was
// previously the same font-size as a one-line label (e.g. "WIND"), so
// wrapping ate noticeably more of the row's fixed height and pushed the
// value down toward the card's bottom edge - shrinking both sizes by the
// same proportion wouldn't fix that, since the value shrinks right along
// with the label instead of the label preferentially making room. Vh-
// based (not rem) for the same reason as the compass readout: the row's
// real available height comes from viewport height via this panel's own
// flex/grid chain, not from vmin (which also moves with viewport width).
// Ceilings land 2px under the previous text-xs/text-3xl sizes (12px/30px
// at this list's 16px-root reference) - both the two-line headroom fix
// and a deliberate small overall reduction happen together here. Floors
// (6px/11px) sit below what a comfortable reading size would be on their
// own - deliberately, so a two-line label still has somewhere to shrink
// to on a shorter-than-usual viewport before its row's own minmax floor
// (below, bumped slightly from 7e7852c's 4.5rem) becomes the binding
// constraint instead of font-size.
const STAT_LABEL_FONT = 'clamp(6px, 0.95vh, 10px)'
const STAT_VALUE_FONT = 'clamp(11px, 2.55vh, 28px)'
// Sized and coloured distinctly from STAT_LABEL_FONT, not just a smaller
// version of the same style - a parenthetical qualifier ("(Shobdon
// Calculated)", "(Met Office Forecast)") is secondary to the main label
// it clarifies, not a second heading of equal weight. Two of five cards
// carry one; those two previously had the SAME font-size as the three
// one-word labels, so their qualifier text wrapped the row's label onto
// a second line at full label height, eating noticeably more of the
// card than a plain "WIND"/"QNH" row and squeezing the value down
// toward the bottom edge. Shrinking just the qualifier - not the whole
// label - frees that height back up without losing the main label's own
// size or legibility. The accent colour (reused from the existing
// design system, not a new one) keeps it visually distinct as
// "supplementary" rather than reading like a dimmer version of the same
// text.
const STAT_QUALIFIER_FONT = 'clamp(5px, 0.75vh, 8px)'

interface LeftInfoPanelProps {
  // When true, the 5-stat grid (Wind/QNH/Temperature/Cloud Base/
  // Visibility Outlook) stays permanently shown - the A/B flip timer to
  // the internal CloudVisibilityChart state never starts. Clubhouse
  // Template 2 shows a standalone Met Office forecast panel elsewhere on
  // the same screen, so this instance should be fixed, not carousel -
  // "more fixed, less carousel" per its own layout spec. Default
  // false/undefined - Template 1/Café's existing flip behaviour (when
  // weatherSummaryChartEnabled is on) is unaffected.
  disableChartFlip?: boolean
  // When true, uses a smaller per-card minimum row height (2.75rem vs
  // the default 4.75rem). Clubhouse Template 2 gives this panel roughly
  // half the vertical room Template 1 always has (a shared lower half,
  // not the full body height), so the default floor - tuned assuming a
  // near-full-height allocation - overflowed its own container at short
  // viewport heights (confirmed at 1280x720/1366x768). The 5 real
  // values here are short (e.g. "NNE 9 kt"), legible well below the
  // default floor. Default false/undefined - Template 1/Café's sizing
  // is completely unaffected.
  compactStats?: boolean
  // When provided, skips the self-fetch below entirely and uses this -
  // same reasoning/story as RightInfoPanel.tsx's own opsPanelData prop
  // (PUBLIC_CONFIG_URL resolves by Host header, wrong for an
  // authenticated admin preview where the session may be switched to a
  // different org than the current subdomain). Lower-stakes than
  // RightInfoPanel's leak in practice (only chart-flip timing, not real
  // tenant content), but fixed for the same reason and the same way.
  // Every existing caller (the real public dashboard) omits this and is
  // unaffected.
  opsPanelChartData?: OpsPanelChartConfig | null
}

export default function LeftInfoPanel({ disableChartFlip, compactStats, opsPanelChartData }: LeftInfoPanelProps = {}): JSX.Element {
  const { weather, liveDataUnavailable, activeProvider } = useWeather()
  const { hours: visibilityHours, fetchedAt: visibilityFetchedAt } = useVisibilityForecast()

  // Self-contained fetch of the public config, matching RightInfoPanel's
  // established pattern - only the three chart-rotation fields are used
  // here, everything else in the response is RightInfoPanel/MediaPanel's
  // concern. Skipped entirely when opsPanelChartData is provided.
  const [chartConfig, setChartConfig] = useState<OpsPanelChartConfig | null>(opsPanelChartData ?? null)

  useEffect(() => {
    if (opsPanelChartData !== undefined) {
      setChartConfig(opsPanelChartData)
      return
    }
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const opsPanel = data?.opsPanel
        setChartConfig({
          weatherSummaryChartEnabled: !!opsPanel?.weatherSummaryChartEnabled,
          weatherSummaryStateADurationSeconds: opsPanel?.weatherSummaryStateADurationSeconds ?? 8,
          weatherSummaryStateBDurationSeconds: opsPanel?.weatherSummaryStateBDurationSeconds ?? 5,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [opsPanelChartData])

  // liveDataUnavailable: the selected source's fetch failed and weather
  // is actually the substituted mock fixture - show N/A rather than
  // presenting that fake data as if it were a real reading.
  const cloudBaseFt =
    !weather || liveDataUnavailable || activeProvider !== 'atc' || weather.dewpoint === undefined
      ? null
      : estimateCloudBaseFt(weather.temperature, weather.dewpoint)
  // Same gate as cloudBaseFt itself - a capturedAt timestamp with no real
  // Cloud Base value alongside it would be a freshness claim about data
  // that isn't actually being shown.
  const cloudBaseCapturedAt = cloudBaseFt === null ? null : (weather?.capturedAt ?? null)
  const visibilityOutlookText = visibilityHours[0]
    ? `${visibilityHours[0].category} (${visibilityHours[0].rangeLabel})`
    : 'Unavailable'

  // qualifier split out from label (was inline in the label string, e.g.
  // "Cloud Base (Shobdon Calculated)") so it can be rendered at its own
  // smaller size/colour - see STAT_QUALIFIER_FONT above.
  const data = [
    {
      label: 'Wind',
      qualifier: null,
      value: !weather || liveDataUnavailable ? 'N/A' : `${degreesToCardinal(weather.windDirection)} ${weather.windSpeed} kt`,
    },
    { label: 'QNH', qualifier: null, value: !weather || liveDataUnavailable ? 'N/A' : `${weather.qnh} hPa` },
    { label: 'Temperature', qualifier: null, value: !weather || liveDataUnavailable ? 'N/A' : `${weather.temperature}°C` },
    {
      // Only ever meaningful from Shobdon's own station (dewpoint has no
      // internet/mock equivalent) - N/A whenever that's not genuinely the
      // live source in use, rather than a calculation from substituted data.
      label: 'Cloud Base',
      qualifier: '(Shobdon Calculated)',
      value: cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`,
    },
    {
      // Net-new predicted data (Shobdon has no visibility sensor at all) -
      // "Unavailable" rather than N/A distinguishes "Met Office couldn't
      // be reached this cycle" from the other cards' "no live reading",
      // and never shows a value held over past its own 60-minute TTL.
      label: 'Visibility Outlook',
      qualifier: '(Met Office Forecast)',
      value: visibilityOutlookText,
    },
  ]

  // State A (today's 5 cards) <-> State B (Cloud/Visibility Chart), with
  // INDEPENDENT durations per state - unlike RightInfoPanel/NOTAMS'
  // single shared setInterval (which can only express one symmetric
  // period), this reuses MediaPanel.tsx's recursive-setTimeout carousel
  // pattern: each scheduled timeout reads whichever state is about to be
  // shown and waits that state's own duration, then flips and reschedules
  // with the new state's own duration. Off (chartConfig not yet loaded,
  // or weatherSummaryChartEnabled false) means State A only, no timer at
  // all - matches the D1 column's own DEFAULT 0 for zero-visible-change.
  const [showChartState, setShowChartState] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timerRef.current)
    setShowChartState(false)
    if (disableChartFlip || !chartConfig?.weatherSummaryChartEnabled) return

    let state: 'A' | 'B' = 'A'
    const scheduleNext = () => {
      const seconds =
        state === 'A' ? chartConfig.weatherSummaryStateADurationSeconds : chartConfig.weatherSummaryStateBDurationSeconds
      timerRef.current = window.setTimeout(() => {
        state = state === 'A' ? 'B' : 'A'
        setShowChartState(state === 'B')
        scheduleNext()
      }, Math.max(1, seconds) * 1000)
    }
    scheduleNext()

    return () => window.clearTimeout(timerRef.current)
  }, [
    disableChartFlip,
    chartConfig?.weatherSummaryChartEnabled,
    chartConfig?.weatherSummaryStateADurationSeconds,
    chartConfig?.weatherSummaryStateBDurationSeconds,
  ])

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 flex-shrink-0 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">
        Weather Summary
      </div>
      <div className="min-h-0 flex-1">
        {showChartState ? (
          <div className="flex h-full flex-col">
            {/* Numeric callouts ABOVE the chart, matching Weather Summary's
                existing heading-then-content order. */}
            {/* min-h-[4.5rem] on each card, not just on the list overall -
                a value that's empty/late (or just short, e.g. "N/A")
                must not be able to collapse this box down to its text's
                own line-height and let "6-Hour Forecast" below shift up
                into it. 4.5rem comfortably fits this card's label +
                text-xl value + padding with room to spare, verified
                against real rendered output, not assumed. */}
            <div className="mb-2 grid flex-shrink-0 grid-cols-2 gap-2">
              <div className="min-h-[4.5rem] rounded-2xl border border-border bg-card p-2">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">Ceiling</div>
                <div className="mt-1 text-xl font-semibold text-primary">
                  {cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`}
                </div>
              </div>
              <div className="min-h-[4.5rem] rounded-2xl border border-border bg-card p-2">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">Visibility</div>
                <div className="mt-1 text-xl font-semibold text-primary">{visibilityOutlookText}</div>
              </div>
            </div>
            {/* No card wrapper here - CloudVisibilityChart renders its
                own two separate bordered cards internally. */}
            <div className="min-h-0 flex-1">
              <CloudVisibilityChart
                cloudBaseFt={cloudBaseFt}
                cloudBaseCapturedAt={cloudBaseCapturedAt}
                visibilityHours={visibilityHours}
                visibilityFetchedAt={visibilityFetchedAt}
              />
            </div>
          </div>
        ) : (
          // Explicit per-row minmax(4.5rem, 1fr), not the previous plain
          // `grid gap-4` (grid-auto-rows: auto, i.e. every row exactly as
          // tall as its own content, however tall that ends up being).
          // That worked fine on the one screen this was built and tested
          // against, but had two real failure modes on any screen with
          // less vertical room for this column: (1) the whole list could
          // run taller than the panel's actual available height, and
          // since every ancestor up to the page root is overflow-hidden
          // with no scrollbar, the last row - whichever one that happened
          // to be - was silently clipped clean off; (2) no row had a
          // reserved minimum height at all, so a genuinely short/empty
          // value (not just today's "N/A" fallback strings, which happen
          // to mask this) could collapse a row toward its label's own
          // line-height, and neighbouring rows would shift to fill the
          // gap. minmax(<floor>, 1fr) fixes both: rows never grow past an
          // equal fr-share of whatever height this panel genuinely has on
          // THIS screen (no overflow/clipping), and never shrink below
          // the floor regardless of content (no collapse/overlap) - true
          // on any resolution, not tuned to either TV this was verified
          // on. 4.75rem, not 7e7852c's original 4.5rem - a small bump
          // (not a large one; the qualifier-shrinking above does most of
          // the work) verified to give reliable headroom across all five
          // cards, including Visibility Outlook's longest realistic
          // value ("Very Good (20.1km-40km)", itself two lines) alongside
          // its own two-part label - not just tuned to today's mock data.
          <div className="grid h-full gap-4" style={{ gridTemplateRows: `repeat(${data.length}, minmax(${compactStats ? '2.75rem' : '4.75rem'}, 1fr))` }}>
            {data.map((item) => (
              <div key={item.label} className="min-h-0 overflow-hidden rounded-3xl border border-border bg-card p-2">
                <div
                  className="uppercase tracking-[0.25em] text-muted-500"
                  style={{ fontSize: STAT_LABEL_FONT, paddingLeft: '4px' }}
                >
                  {item.label}
                  {item.qualifier && (
                    <span className="text-accent-sky-400" style={{ fontSize: STAT_QUALIFIER_FONT }}>
                      {' '}
                      {item.qualifier}
                    </span>
                  )}
                </div>
                <div className="mt-1 font-semibold text-primary" style={{ fontSize: STAT_VALUE_FONT }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
