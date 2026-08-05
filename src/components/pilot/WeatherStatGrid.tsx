import { useWeather } from '../../context/WeatherContext'
import { degreesToCardinal } from '../../utils/windCalculations'
import { estimateCloudBaseFt } from '../../utils/cloudBase'
import { useVisibilityForecast } from '../../services/visibilityForecastService'

// Pilot View extraction (Section 2 - Weather Summary) - the same six
// stat cards LeftInfoPanel.tsx's compact state renders (Wind/QNH/QFE/
// Temperature/Cloud Base/Visibility Outlook), pulled out into their own
// always-visible component rather than reusing LeftInfoPanel directly.
// LeftInfoPanel's `data` array is reused nowhere here - the two files
// intentionally diverge on sizing (LeftInfoPanel's vh-based clamp()s are
// tuned for a fixed TV/kiosk viewport height; this component uses plain
// Tailwind text sizes for a naturally-scrolling phone page) even though
// the underlying values/gating logic is identical. Self-contained (own
// useWeather()/useVisibilityForecast() calls), matching every other
// "drop in anywhere" panel in this codebase (CompassPanel, GasPricesPanel).
export default function WeatherStatGrid(): JSX.Element {
  const { weather, liveDataUnavailable, activeProvider } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  const cloudBaseFt =
    !weather || liveDataUnavailable || activeProvider !== 'atc' || weather.dewpoint === undefined
      ? null
      : estimateCloudBaseFt(weather.temperature, weather.dewpoint)
  const visibilityOutlookText = visibilityHours[0]
    ? `${visibilityHours[0].category} (${visibilityHours[0].rangeLabel})`
    : 'Unavailable'

  const stats = [
    {
      label: 'Wind',
      value: !weather || liveDataUnavailable ? 'N/A' : `${degreesToCardinal(weather.windDirection)} ${weather.windSpeed} kt`,
    },
    { label: 'QNH', value: !weather || liveDataUnavailable ? 'N/A' : `${weather.qnh} hPa` },
    {
      // Only ever populated by the 'atc' provider - see WeatherData's
      // own comment. N/A for every other source.
      label: 'QFE',
      value: !weather || liveDataUnavailable || weather.qfe === undefined ? 'N/A' : `${weather.qfe} hPa`,
    },
    { label: 'Temperature', value: !weather || liveDataUnavailable ? 'N/A' : `${weather.temperature}°C` },
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
      <div className="mb-3 text-center text-base font-semibold uppercase tracking-[0.25em] text-muted-400">Weather Summary</div>
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
            <div className="flex items-baseline gap-0.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-normal text-muted-400">
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
