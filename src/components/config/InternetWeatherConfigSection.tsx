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

      {/* One-source-of-truth round - these used to be freely editable
          here, independent of (and never kept in sync with) Airfield
          Location's own postcode/manual-override fields below on this
          same page, which meant two different places could each think
          they were "the" tenant location and silently disagree. Now
          read-only: ConfigPage.tsx keeps config.internet.latitude/
          longitude synced to Airfield Location's own saved value
          automatically (both on load and immediately after a save
          there, no reload needed), so this always reflects the same
          single source rather than offering a second place to edit it
          that would just drift again the moment someone typed into it.
          Editing location is done in Airfield Location; this is
          confirmation of what Internet Weather will actually use. */}
      <ConfigField label="Latitude">
        <input
          type="number"
          step="0.0001"
          readOnly
          disabled
          className={`${configInputClassName} cursor-not-allowed opacity-60`}
          value={config.latitude}
          title="Set via the Airfield Location section below"
        />
      </ConfigField>

      <ConfigField label="Longitude">
        <div>
          <input
            type="number"
            step="0.0001"
            readOnly
            disabled
            className={`${configInputClassName} cursor-not-allowed opacity-60`}
            value={config.longitude}
            title="Set via the Airfield Location section below"
          />
          <p className="mt-1.5 text-xs text-slate-500">Set via the Airfield Location section below.</p>
        </div>
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
