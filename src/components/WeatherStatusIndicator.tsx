import { useWeather } from '../context/WeatherContext'
import { INTERNET_WEATHER_PROVIDERS } from '../services/internetProviders'
import type { WeatherProviderId } from '../types/weatherConfig'

const STATUS_BY_PROVIDER: Record<Exclude<WeatherProviderId, 'internet'>, { emoji: string; label: string }> = {
  atc: { emoji: '🟢', label: 'ATC LIVE' },
  mock: { emoji: '🟠', label: 'MOCK' },
}

export default function WeatherStatusIndicator(): JSX.Element {
  const { activeProvider, config } = useWeather()

  const { emoji, label } =
    activeProvider === 'internet'
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
