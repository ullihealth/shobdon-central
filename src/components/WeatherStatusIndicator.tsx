import { useWeather } from '../context/WeatherContext'
import { INTERNET_WEATHER_PROVIDERS } from '../services/internetProviders'
import type { WeatherProviderId } from '../types/weatherConfig'

const STATUS_BY_PROVIDER: Record<Exclude<WeatherProviderId, 'internet'>, { emoji: string; label: string }> = {
  atc: { emoji: '🟢', label: 'ATC SHOBDON (LIVE)' },
  mock: { emoji: '🟠', label: 'MOCK' },
}

export default function WeatherStatusIndicator(): JSX.Element {
  const { activeProvider, config, liveDataUnavailable } = useWeather()

  // liveDataUnavailable means the selected source's fetch failed and the
  // numbers on screen are the substituted mock fixture, not real data -
  // that must never be labelled as if it were the selected live source.
  const { emoji, label } = liveDataUnavailable
    ? { emoji: '🔴', label: 'NO LIVE READING' }
    : activeProvider === 'internet'
      ? {
          emoji: '🔵',
          label: `INTERNET: ${INTERNET_WEATHER_PROVIDERS[config.internet.provider].label.toUpperCase()}`,
        }
      : STATUS_BY_PROVIDER[activeProvider]

  return (
    <div className="flex items-center gap-2 text-base font-bold tracking-wide text-slate-200">
      <span aria-hidden="true">{emoji}</span>
      <span>{label}</span>
    </div>
  )
}
