import { useEffect, useRef, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { degreesToCardinal } from '../utils/windCalculations'
import { estimateCloudBaseFt } from '../utils/cloudBase'
import { useVisibilityForecast } from '../services/visibilityForecastService'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import CloudVisibilityChart from './CloudVisibilityChart'

interface OpsPanelChartConfig {
  weatherSummaryChartEnabled: boolean
  weatherSummaryStateADurationSeconds: number
  weatherSummaryStateBDurationSeconds: number
}

export default function LeftInfoPanel(): JSX.Element {
  const { weather, liveDataUnavailable, activeProvider } = useWeather()
  const { hours: visibilityHours, fetchedAt: visibilityFetchedAt } = useVisibilityForecast()

  // Self-contained fetch of the public config, matching RightInfoPanel's
  // established pattern - only the three chart-rotation fields are used
  // here, everything else in the response is RightInfoPanel/MediaPanel's
  // concern.
  const [chartConfig, setChartConfig] = useState<OpsPanelChartConfig | null>(null)

  useEffect(() => {
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
  }, [])

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

  const data = [
    {
      label: 'Wind',
      value: !weather || liveDataUnavailable ? 'N/A' : `${degreesToCardinal(weather.windDirection)} ${weather.windSpeed} kt`,
    },
    { label: 'QNH', value: !weather || liveDataUnavailable ? 'N/A' : `${weather.qnh} hPa` },
    { label: 'Temperature', value: !weather || liveDataUnavailable ? 'N/A' : `${weather.temperature}°C` },
    {
      // Only ever meaningful from Shobdon's own station (dewpoint has no
      // internet/mock equivalent) - N/A whenever that's not genuinely the
      // live source in use, rather than a calculation from substituted data.
      label: 'Cloud Base (Shobdon Calculated)',
      value: cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`,
    },
    {
      // Net-new predicted data (Shobdon has no visibility sensor at all) -
      // "Unavailable" rather than N/A distinguishes "Met Office couldn't
      // be reached this cycle" from the other cards' "no live reading",
      // and never shows a value held over past its own 60-minute TTL.
      label: 'Visibility Outlook (Met Office Forecast)',
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
    if (!chartConfig?.weatherSummaryChartEnabled) return

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
          // gap. minmax(4.5rem, 1fr) fixes both: rows never grow past an
          // equal fr-share of whatever height this panel genuinely has on
          // THIS screen (no overflow/clipping), and never shrink below
          // 4.5rem regardless of content (no collapse/overlap) - true on
          // any resolution, not tuned to either TV this was verified on.
          <div className="grid h-full gap-4" style={{ gridTemplateRows: `repeat(${data.length}, minmax(4.5rem, 1fr))` }}>
            {data.map((item) => (
              <div key={item.label} className="min-h-0 overflow-hidden rounded-3xl border border-border bg-card p-2">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{item.label}</div>
                <div className="mt-1 text-3xl font-semibold text-primary">{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
