import type { InternetConfig, InternetWeatherProviderId } from '../../types/weatherConfig'
import { INTERNET_WEATHER_PROVIDERS } from '../../services/internetProviders'
import ConfigField, { configInputClassName } from './ConfigField'

interface InternetWeatherConfigSectionProps {
  config: InternetConfig
  onChange: (config: InternetConfig) => void
  // Per-tenant override (migration 0083) for the 'open-meteo' option's
  // displayed name specifically - null means no override, show the
  // registry's own generic label exactly as before this existed. Only
  // ever applies to the 'open-meteo' entry, not any other provider this
  // registry might grow later (see the .map() below).
  openMeteoDisplayName: string | null
}

export default function InternetWeatherConfigSection({
  config,
  onChange,
  openMeteoDisplayName,
}: InternetWeatherConfigSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Internet Weather</h3>

      <ConfigField label="Provider">
        <select
          className={configInputClassName}
          value={config.provider}
          onChange={(event) =>
            onChange({ ...config, provider: event.target.value as InternetWeatherProviderId })
          }
        >
          {Object.entries(INTERNET_WEATHER_PROVIDERS).map(([id, provider]) => (
            <option key={id} value={id}>
              {id === 'open-meteo' && openMeteoDisplayName ? openMeteoDisplayName : provider.label}
            </option>
          ))}
        </select>
      </ConfigField>

      <ConfigField label="Latitude">
        <input
          type="number"
          step="0.0001"
          className={configInputClassName}
          value={config.latitude}
          onChange={(event) => onChange({ ...config, latitude: Number(event.target.value) })}
        />
      </ConfigField>

      <ConfigField label="Longitude">
        <input
          type="number"
          step="0.0001"
          className={configInputClassName}
          value={config.longitude}
          onChange={(event) => onChange({ ...config, longitude: Number(event.target.value) })}
        />
      </ConfigField>

      <ConfigField label="Refresh Interval">
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={5}
            className={configInputClassName}
            value={config.refreshIntervalSeconds}
            onChange={(event) => onChange({ ...config, refreshIntervalSeconds: Number(event.target.value) })}
          />
          <span className="text-slate-400">seconds</span>
        </div>
      </ConfigField>
    </div>
  )
}
