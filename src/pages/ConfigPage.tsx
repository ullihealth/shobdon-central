import { useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import WeatherSourceSelector from '../components/config/WeatherSourceSelector'
import AtcWeatherConfigSection from '../components/config/AtcWeatherConfigSection'
import AtcDeveloperTools from '../components/config/AtcDeveloperTools'
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
    <div className="min-h-screen bg-gradient-to-b from-[#071229] via-[#081827] to-[#03101a] text-slate-100">
      {/* Header uses the same wide container as the dashboard so the absolutely-centred
          clock has room and never overlaps the title. */}
      <div className="mx-auto h-24 max-w-[1920px] px-10 pt-6">
        <Header />
      </div>

      <div className="mx-auto max-w-3xl px-6 pb-10">
        <div className="mt-6 rounded-3xl border border-slate-700 bg-slate-950/85 p-10 shadow-xl shadow-slate-950/20">
          <div className="mb-8 flex flex-wrap gap-3">
            <Link
              to="/checklist"
              className="inline-block rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
            >
              📋 ATC Visit Checklist
            </Link>
            <Link
              to="/design"
              className="inline-block rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
            >
              🎨 Dashboard Design
            </Link>
            <Link
              to="/runways"
              className="inline-block rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
            >
              🛬 Runways
            </Link>
          </div>

          <WeatherSourceSelector value={config.activeProvider} onChange={handleSourceChange} />

          <div className="mt-10 border-t border-slate-800 pt-10">
            {config.activeProvider === 'atc' && (
              <>
                <AtcWeatherConfigSection config={config.atc} onChange={(atc) => updateConfig({ ...config, atc })} />
                <AtcDeveloperTools />
              </>
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
    </div>
  )
}
