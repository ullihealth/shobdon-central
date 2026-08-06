import { useEffect, useState } from 'react'
import { useWeather } from '../../context/WeatherContext'
import { estimateCloudBaseFt } from '../../utils/cloudBase'
import { useVisibilityForecast } from '../../services/visibilityForecastService'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'

// publicVisibilityForecast.ts's own rangeLabel format (e.g. "20.1km-40km",
// "<1km", ">40km") is shared verbatim with LeftInfoPanel.tsx's desktop
// card - not something this mobile-only file can change at the source
// without also changing the TV dashboard. This reformats it locally,
// purely for display here: drops the decimal (20.1km -> 20km, matching
// the whole-km precision the category bands are already defined in) and
// collapses the repeated "km" in a closed range down to one, at the end
// only ("20.1km-40km" -> "20-40km") - what was actually forcing this
// card's value onto three lines at the larger font size this round
// introduced. Falls through to the raw label unchanged for any shape
// that doesn't match (defensive only - every real category band above
// is one of these two shapes).
function formatVisibilityRange(rangeLabel: string): string {
  const closedRange = rangeLabel.match(/^(\d+(?:\.\d+)?)km-(\d+(?:\.\d+)?)km$/)
  if (closedRange) return `${Math.round(Number(closedRange[1]))}-${Math.round(Number(closedRange[2]))}km`
  const openRange = rangeLabel.match(/^([<>])(\d+(?:\.\d+)?)km$/)
  if (openRange) return `${openRange[1]}${Math.round(Number(openRange[2]))}km`
  return rangeLabel
}

// Pilot View extraction (Section 2 - Weather Summary) - four of the six
// stat cards LeftInfoPanel.tsx's compact state renders (QNH/QFE/Cloud
// Base/Visibility Outlook; Wind and Temperature dropped here - Wind is
// redundant with the "WIND" readout PilotRunwayWindPanel already shows
// prominently below, and Temperature was dropped alongside it per the
// same request), pulled out into their own always-visible component
// rather than reusing LeftInfoPanel directly. LeftInfoPanel's `data`
// array is reused nowhere here - the two files intentionally diverge on
// sizing (LeftInfoPanel's vh-based clamp()s are tuned for a fixed
// TV/kiosk viewport height; this component uses plain Tailwind text
// sizes for a naturally-scrolling phone page) even though the
// underlying values/gating logic is identical. Self-contained (own
// useWeather()/useVisibilityForecast() calls), matching every other
// "drop in anywhere" panel in this codebase (CompassPanel, GasPricesPanel).
export default function WeatherStatGrid(): JSX.Element {
  const { weather, liveDataUnavailable, activeProvider } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()
  // Consistent QNH/QFE rounding round (migration 0074) - null for every
  // tenant except Shobdon and tenants linked to it (see publicConfig.ts's
  // own qnhQfeOffsetHpa comment for the full mechanism). Self-fetched
  // here rather than threaded down from PilotViewPage, same "each panel
  // independently fetches what it needs" convention every other self-
  // contained /pilot panel already uses.
  const [qnhQfeOffsetHpa, setQnhQfeOffsetHpa] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setQnhQfeOffsetHpa(typeof data?.qnhQfeOffsetHpa === 'number' ? data.qnhQfeOffsetHpa : null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const cloudBaseFt =
    !weather || liveDataUnavailable || activeProvider !== 'atc' || weather.dewpoint === undefined
      ? null
      : estimateCloudBaseFt(weather.temperature, weather.dewpoint)
  // Category (Very Good/Poor/etc) dropped from this value entirely, not
  // just the decimal/double-km cleanup above - even with those fixes,
  // "Very Good" plus a range still wrapped to two lines on a real phone
  // card (measured), pushing this card taller than its siblings and the
  // compass lower down the page with it. The range alone is what's left
  // once "Cloud Base"/"QFE" etc are already just numbers with no
  // descriptive word either - consistent with the rest of this grid, not
  // a special case.
  const visibilityOutlookText = visibilityHours[0] ? formatVisibilityRange(visibilityHours[0].rangeLabel) : 'Unavailable'

  const hasWeather = !!weather && !liveDataUnavailable
  // Math.round, not truncation - "1018.6 hPa" must read "1019 hPa", not
  // "1018 hPa". QNH always rounds independently, same as every other
  // tenant - only QFE's rounding changes when a fixed offset is known.
  const roundedQnh = hasWeather ? Math.round(weather.qnh) : null
  // Shobdon/linked-tenant round: QNH and QFE are known to always differ
  // by exactly qnhQfeOffsetHpa in reality - rounding each independently
  // could display a difference of 12 instead of 11 whenever the two raw
  // decimals straddle a .5 boundary in opposite directions. Deriving QFE
  // from QNH's own (already-rounded) value instead guarantees the
  // displayed gap is always exactly right, and - as a side effect - also
  // produces a real QFE value for a linked tenant on the 'ingested'
  // provider even though that provider doesn't carry its own qfe field
  // at all today. Every other tenant (qnhQfeOffsetHpa null) falls
  // through to the original independent-rounding-with-N/A-gate behaviour
  // unchanged.
  const qfeText = !hasWeather
    ? 'N/A'
    : qnhQfeOffsetHpa !== null && roundedQnh !== null
      ? `${roundedQnh - qnhQfeOffsetHpa} hPa`
      : weather.qfe === undefined
        ? 'N/A'
        : `${Math.round(weather.qfe)} hPa`

  const stats = [
    { label: 'QNH', value: roundedQnh === null ? 'N/A' : `${roundedQnh} hPa` },
    {
      // Only ever populated by the 'atc' provider (independent-rounding
      // path only) - see WeatherData's own comment. N/A for every other
      // source unless qnhQfeOffsetHpa makes it derivable from QNH alone.
      label: 'QFE',
      value: qfeText,
    },
    {
      label: 'Cloud Base',
      qualifier: 'Shobdon Calculated',
      value: cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`,
    },
    {
      label: 'Visibility',
      qualifier: 'Met Office Forecast',
      value: visibilityOutlookText,
    },
  ]

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 text-center text-base font-semibold uppercase tracking-[0.25em] text-muted-400">Summary</div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-2.5">
            {/* Title and qualifier each on their own row now (was one
                inline row, tracking dropped to normal to fit the
                abbreviated qualifier on one line) - restored to the full
                qualifier text ("Shobdon Calculated"/"Met Office Forecast")
                per request, which no longer fits alongside the title on
                this card's ~145px width at the title's own font size, so
                it gets its own row between title and value instead. Same
                small/dim blue styling as before, just relocated. */}
            <div className="text-[14px] font-semibold uppercase tracking-normal text-muted-400">{stat.label}</div>
            {stat.qualifier && (
              <div className="text-[8px] font-normal tracking-normal text-accent-sky-400">({stat.qualifier})</div>
            )}
            <div className="mt-1 text-[22px] font-semibold text-primary">{stat.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
