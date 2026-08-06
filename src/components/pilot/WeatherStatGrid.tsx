import { useWeather } from '../../context/WeatherContext'
import { estimateCloudBaseFt } from '../../utils/cloudBase'
import { useVisibilityForecast } from '../../services/visibilityForecastService'

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

  const stats = [
    // Math.round, not truncation - "1018.6 hPa" must read "1019 hPa", not
    // "1018 hPa". Both QNH and QFE come straight off the ATC station
    // reading with a decimal; the whole-number precision is a display
    // choice made here, not a change to the underlying stored/fetched
    // value (nothing else reads weather.qnh/qfe for a calculation that
    // would need the decimal).
    { label: 'QNH', value: !weather || liveDataUnavailable ? 'N/A' : `${Math.round(weather.qnh)} hPa` },
    {
      // Only ever populated by the 'atc' provider - see WeatherData's
      // own comment. N/A for every other source.
      label: 'QFE',
      value: !weather || liveDataUnavailable || weather.qfe === undefined ? 'N/A' : `${Math.round(weather.qfe)} hPa`,
    },
    {
      label: 'Cloud Base',
      qualifier: 'Shobdon Calc',
      value: cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`,
    },
    {
      label: 'Visibility',
      qualifier: 'Met Forecast',
      value: visibilityOutlookText,
    },
  ]

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 text-center text-base font-semibold uppercase tracking-[0.25em] text-muted-400">Summary</div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-2.5">
            {/* flex + whitespace-nowrap (not the plain wrapping block this
                started as) - the shortened qualifiers above exist for the
                same reason as this row layout: "Cloud Base (Shobdon Calc)"
                must render on one line, not wrap, at the larger label size
                below. Letter-spacing (tracking) is deliberately dropped
                back to normal here, not just kept smaller than the title -
                it was the single biggest cost toward the two-line wrap this
                is fixing (measured: removing it alone recovered ~26px of a
                card that's only ~145px wide on a real phone viewport). The
                qualifier keeps its own smaller/dimmer styling rather than
                inheriting the bumped label size - it's a secondary
                annotation, not itself one of the card labels the
                brightness/size increase was asked for, and giving it the
                same size is exactly what would push this back over one line. */}
            <div className="flex items-baseline gap-0.5 whitespace-nowrap text-[14px] font-semibold uppercase tracking-normal text-muted-400">
              <span>{stat.label}</span>
              {stat.qualifier && <span className="text-[8px] font-normal tracking-normal text-accent-sky-400">({stat.qualifier})</span>}
            </div>
            <div className="mt-1 text-[22px] font-semibold text-primary">{stat.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
