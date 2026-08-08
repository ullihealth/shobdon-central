import type { InternetConfig, InternetWeatherProviderId } from '../../types/weatherConfig'
import { INTERNET_WEATHER_PROVIDERS } from '../../services/internetProviders'
import ConfigField, { configInputClassName } from './ConfigField'

interface InternetWeatherConfigSectionProps {
  config: InternetConfig
  onChange: (config: InternetConfig) => void
  // Server-derived display name for the 'open-meteo' option specifically
  // ("Met-Office SAWS" for Shobdon/tenants linked to it, bare "Met-Office"
  // otherwise - see ConfigPage.tsx's own fetch and WeatherContext.tsx's
  // matching copy for the full "why"). null only while ConfigPage.tsx's
  // own fetch hasn't resolved yet - falls back to the generic "Met-Office"
  // in that brief window, NEVER to the registry's own "Open-Meteo" label
  // (see the .map() below) - "Open-Meteo" must never be shown to any
  // tenant, not even transiently. Only ever applies to the 'open-meteo'
  // entry, not any other provider this registry might grow later.
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
              {id === 'open-meteo' ? (openMeteoDisplayName ?? 'Met-Office') : provider.label}
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
