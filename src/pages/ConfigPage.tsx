import { useState } from 'react'
import { Link } from 'react-router-dom'
import WeatherSourceSelector from '../components/config/WeatherSourceSelector'
import AtcWeatherConfigSection from '../components/config/AtcWeatherConfigSection'
import InternetWeatherConfigSection from '../components/config/InternetWeatherConfigSection'
import MockWeatherConfigSection from '../components/config/MockWeatherConfigSection'
import { loadWeatherConfig, saveWeatherConfig } from '../services/weatherConfigStore'
import type { WeatherConfig, WeatherProviderId } from '../types/weatherConfig'

export default function ConfigPage(): JSX.Element {
  const [config, setConfig] = useState<WeatherConfig>(() => loadWeatherConfig())

  function updateConfig(next: WeatherConfig) {
    setConfig(next)
    saveWeatherConfig(next)
  }

  function handleSourceChange(activeProvider: WeatherProviderId) {
    updateConfig({ ...config, activeProvider })
  }

  return (
    <div className="mx-auto max-w-3xl px-6 pb-10 pt-10">
      <div className="rounded-3xl border border-slate-700 bg-slate-950/85 p-10 shadow-xl shadow-slate-950/20">
        {/* Not part of the sidebar - /checklist is a public, non-role-gated
            route (no RequireAuth), so it doesn't belong in the authenticated
            admin nav. Kept reachable here as page content instead. */}
        <div className="mb-8">
          <Link
            to="/checklist"
            className="inline-block rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
          >
            📋 ATC Visit Checklist
          </Link>
        </div>

        <WeatherSourceSelector value={config.activeProvider} onChange={handleSourceChange} />

        <div className="mt-10 border-t border-slate-800 pt-10">
          {config.activeProvider === 'atc' && (
            <AtcWeatherConfigSection config={config.atc} onChange={(atc) => updateConfig({ ...config, atc })} />
          )}
          {config.activeProvider === 'internet' && (
            <InternetWeatherConfigSection
              config={config.internet}
              onChange={(internet) => updateConfig({ ...config, internet })}
            />
          )}
          {config.activeProvider === 'mock' && <MockWeatherConfigSection />}
        </div>
      </div>
    </div>
  )
}
