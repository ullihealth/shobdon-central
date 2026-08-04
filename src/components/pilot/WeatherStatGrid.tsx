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
      qualifier: 'Shobdon Calculated',
      value: cloudBaseFt === null ? 'N/A' : `${cloudBaseFt} ft AGL`,
    },
    {
      label: 'Visibility Outlook',
      qualifier: 'Met Office Forecast',
      value: visibilityOutlookText,
    },
  ]

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 text-center text-sm font-semibold uppercase tracking-[0.25em] text-muted-400">Weather Summary</div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-500">
              {stat.label}
              {stat.qualifier && <span className="ml-1 text-accent-sky-400">({stat.qualifier})</span>}
            </div>
            <div className="mt-1 text-xl font-semibold text-primary">{stat.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
