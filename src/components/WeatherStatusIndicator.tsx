import { useWeather } from '../context/WeatherContext'
import { INTERNET_WEATHER_PROVIDERS } from '../services/internetProviders'
import type { WeatherProviderId } from '../types/weatherConfig'

// 'atc' removed from this table - its label now depends on usingFallback
// (see below), which this static table has no way to express. Also fixes
// a pre-existing bug this table had regardless of this feature: its type
// promised an entry for every WeatherProviderId except 'internet' (so
// 'atc' | 'ingested' | 'mock'), but 'ingested' was never actually in the
// object literal - harmless in practice since nothing here ever read
// STATUS_BY_PROVIDER.ingested, but a real, standing tsc error. Fixed in
// passing since this exact object is being rewritten for the fallback
// badge anyway, not a separate unrelated change.
const STATUS_BY_PROVIDER: Record<Exclude<WeatherProviderId, 'internet' | 'atc'>, { emoji: string; label: string }> = {
  ingested: { emoji: '🟣', label: 'THIRD-PARTY STATION' },
  mock: { emoji: '🟠', label: 'MOCK' },
}

export default function WeatherStatusIndicator(): JSX.Element {
  const { activeProvider, config, liveDataUnavailable, usingFallback, reconnectToAtc } = useWeather()

  // liveDataUnavailable means the selected source's fetch failed and the
  // numbers on screen are the substituted mock fixture, not real data -
  // that must never be labelled as if it were the selected live source.
  const { emoji, label } = liveDataUnavailable
    ? { emoji: '🔴', label: 'NO LIVE READING' }
    : activeProvider === 'atc'
      ? usingFallback
        ? { emoji: '🔵', label: 'FALLBACK — INTERNET WEATHER' }
        : { emoji: '🟢', label: 'LIVE ATC' }
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
      {/* Manual override for the "Auto-reconnect to ATC" toggle being off
          (config.atc.autoReconnectEnabled) - always shown while on
          fallback regardless of that setting, since forcing an immediate
          recheck is harmless either way, just more operationally useful
          when auto-reconnect won't do it on its own. A no-op click on a
          kiosk display with no pointer is inert, not broken - same
          posture as every other public, unauthenticated display page in
          this app having zero interactive admin controls otherwise. */}
      {!liveDataUnavailable && activeProvider === 'atc' && usingFallback && (
        <button
          type="button"
          onClick={reconnectToAtc}
          className="rounded border border-slate-600 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          Reconnect now
        </button>
      )}
    </div>
  )
}
