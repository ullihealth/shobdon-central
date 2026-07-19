import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import WeatherSourceSelector from '../components/config/WeatherSourceSelector'
import AtcWeatherConfigSection from '../components/config/AtcWeatherConfigSection'
import IngestedWeatherConfigSection from '../components/config/IngestedWeatherConfigSection'
import InternetWeatherConfigSection from '../components/config/InternetWeatherConfigSection'
import MockWeatherConfigSection from '../components/config/MockWeatherConfigSection'
import PC2CaptureSetup from '../components/config/PC2CaptureSetup'
import StorageUsage from '../components/config/StorageUsage'
import { loadWeatherConfig, resolveWeatherConfig, saveWeatherConfig } from '../services/weatherConfigStore'
import type { WeatherConfig, WeatherProviderId } from '../types/weatherConfig'

export default function ConfigPage(): JSX.Element {
  // Starts with the synchronous local value (unchanged, no blank flash),
  // then - only if nothing was actually stored yet - resolves to this
  // tenant's own server-side default instead of staying on the
  // hardcoded 'mock' + Shobdon-coordinates fallback. An already-
  // configured device (Shobdon's own kiosks/PC2 flow) has a stored
  // value, so resolveWeatherConfig() just returns it unchanged here too
  // - this is a no-op for them, not a behaviour change.
  const [config, setConfig] = useState<WeatherConfig>(() => loadWeatherConfig())

  useEffect(() => {
    let cancelled = false
    resolveWeatherConfig().then((resolved) => {
      if (!cancelled) setConfig(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function updateConfig(next: WeatherConfig) {
    setConfig(next)
    saveWeatherConfig(next)
  }

  function handleSourceChange(activeProvider: WeatherProviderId) {
    updateConfig({ ...config, activeProvider })
  }

  return (
    // Was mx-auto max-w-3xl wrapping a single narrow card, regardless of
    // viewport width - on a real desktop browser that left most of the
    // screen empty. max-w-7xl + a 2-column grid below use the space this
    // page's own AdminLayout.tsx shell (flex-1 main, sidebar already
    // accounted for) actually has, and fall back to a single stacked
    // column under lg (matching the old layout) rather than ever
    // squeezing these two independent cards to fit a fixed width.
    <div className="mx-auto max-w-7xl px-6 pb-10 pt-10">
      {/* Not part of the sidebar - /checklist is a public, non-role-gated
          route (no RequireAuth), so it doesn't belong in the authenticated
          admin nav. Kept reachable here as page content instead. */}
      <div className="mb-6">
        <Link
          to="/checklist"
          className="inline-block rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          📋 ATC Visit Checklist
        </Link>
      </div>

      {/* Weather Source and the active provider's own settings are
          independent concerns (which source vs. that source's connection
          details) - side by side on a wide screen instead of stacked in
          one column, same content/behaviour as before either way. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
          <WeatherSourceSelector value={config.activeProvider} onChange={handleSourceChange} />
        </div>

        <div className="rounded-3xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
          {config.activeProvider === 'atc' && (
            <AtcWeatherConfigSection config={config.atc} onChange={(atc) => updateConfig({ ...config, atc })} />
          )}
          {config.activeProvider === 'internet' && (
            <InternetWeatherConfigSection
              config={config.internet}
              onChange={(internet) => updateConfig({ ...config, internet })}
            />
          )}
          {config.activeProvider === 'ingested' && <IngestedWeatherConfigSection />}
          {config.activeProvider === 'mock' && <MockWeatherConfigSection />}
        </div>
      </div>

      <div className="mt-6">
        <PC2CaptureSetup />
      </div>

      <div className="mt-6">
        <StorageUsage />
      </div>
    </div>
  )
}
