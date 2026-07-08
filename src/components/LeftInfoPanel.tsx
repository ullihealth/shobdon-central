import { useWeather } from '../context/WeatherContext'
import { degreesToCardinal } from '../utils/windCalculations'

export default function LeftInfoPanel(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()

  // liveDataUnavailable: the selected source's fetch failed and weather
  // is actually the substituted mock fixture - show N/A (matching
  // Visibility's existing "not available" treatment) rather than
  // presenting that fake data as if it were a real reading.
  const data = [
    {
      label: 'Wind',
      value: !weather || liveDataUnavailable ? 'N/A' : `${degreesToCardinal(weather.windDirection)} ${weather.windSpeed} kt`,
    },
    { label: 'QNH', value: !weather || liveDataUnavailable ? 'N/A' : `${weather.qnh} hPa` },
    { label: 'Temperature', value: !weather || liveDataUnavailable ? 'N/A' : `${weather.temperature}°C` },
    { label: 'Visibility', value: 'N/A' },
    { label: 'Notices', value: '4 active' },
  ]

  return (
    <div className="h-full rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">Weather Summary</div>
      <div className="grid gap-4">
        {data.map((item) => (
          <div key={item.label} className="rounded-3xl border border-border bg-card p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{item.label}</div>
            <div className="mt-3 text-3xl font-semibold text-primary">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
