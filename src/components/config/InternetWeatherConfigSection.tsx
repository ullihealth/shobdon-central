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
  // One-source-of-truth round, take 2 - deliberately NOT config.latitude/
  // config.longitude (below fix's own first attempt routed display
  // through those, via config.internet kept "in sync" by ConfigPage.tsx -
  // that raced against this same page's OWN separate resolveWeatherConfig()
  // effect, which unconditionally overwrites the whole config from
  // whatever's in localStorage the instant IT resolves, with zero
  // awareness of the tenant's real lat/lon. Whichever effect's promise
  // settled last won, so a browser with any pre-existing (even stale/
  // blank) localStorage entry could see this correctly-fixed value
  // silently clobbered back to blank moments after load - confirmed
  // happening for real on newcustomer.airfieldcentral.com/config).
  // tenantLat/tenantLon bypass that shared, contested state completely -
  // ConfigPage.tsx's own direct TENANT_CONFIG_URL fetch is the ONLY
  // thing that ever sets them, so there's no second writer left to race
  // against. null while ConfigPage.tsx's fetch hasn't resolved yet, or
  // the tenant genuinely has no location on file.
  tenantLat: number | null
  tenantLon: number | null
}

export default function InternetWeatherConfigSection({
  config,
  onChange,
  openMeteoDisplayName,
  tenantLat,
  tenantLon,
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
          read-only, showing tenantLat/tenantLon directly (see this
          component's own props comment for why NOT config.latitude/
          longitude) - always reflects the same single source rather
          than offering a second place to edit it that would just drift
          again the moment someone typed into it. Editing location is
          done in Airfield Location; this is confirmation of what
          Internet Weather will actually use. Blank (not "0" or "NaN")
          while tenantLat/tenantLon are still null - either ConfigPage.tsx's
          fetch hasn't resolved yet, or this tenant genuinely has no
          location on file, neither of which should ever display as a
          plausible-looking number. */}
      <ConfigField label="Latitude">
        <input
          type="number"
          step="0.0001"
          readOnly
          disabled
          className={`${configInputClassName} cursor-not-allowed opacity-60`}
          value={tenantLat ?? ''}
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
            value={tenantLon ?? ''}
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
