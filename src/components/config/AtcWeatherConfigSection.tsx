import type { AtcConfig } from '../../types/weatherConfig'
import ConfigField, { configInputClassName } from './ConfigField'

interface AtcWeatherConfigSectionProps {
  config: AtcConfig
  onChange: (config: AtcConfig) => void
}

export default function AtcWeatherConfigSection({ config, onChange }: AtcWeatherConfigSectionProps): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">ATC Weather Station</h3>

      <ConfigField label="Station URL">
        <input
          type="text"
          className={configInputClassName}
          value={config.stationUrl}
          onChange={(event) => onChange({ ...config, stationUrl: event.target.value })}
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

      <ConfigField label="Connection Timeout">
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={500}
            step={500}
            className={configInputClassName}
            value={config.connectionTimeoutMs}
            onChange={(event) => onChange({ ...config, connectionTimeoutMs: Number(event.target.value) })}
          />
          <span className="text-slate-400">ms</span>
        </div>
      </ConfigField>

      <ConfigField label="Auto-reconnect to ATC">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={config.autoReconnectEnabled}
            onChange={(event) => onChange({ ...config, autoReconnectEnabled: event.target.checked })}
            className="h-5 w-5 accent-sky-500"
          />
          <span className="text-sm text-slate-300">
            {config.autoReconnectEnabled
              ? 'On - switches back to Live ATC automatically once it recovers'
              : 'Off - stays on the internet fallback until manually reconnected'}
          </span>
        </label>
      </ConfigField>
    </div>
  )
}
