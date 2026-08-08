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

// "Shobdon Airfield" -> "SHOBDON" - keeps the badge short (it sits in a
// fixed top-right corner alongside the clock) rather than spelling out
// a full tenant name every time.
function firstWordUpper(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? name).toUpperCase()
}

export default function WeatherStatusIndicator(): JSX.Element {
  const { activeProvider, weather, config, liveDataUnavailable, usingFallback, internetProviderDisplayName } = useWeather()

  // liveDataUnavailable means the selected source's fetch failed and the
  // numbers on screen are the substituted mock fixture, not real data -
  // that must never be labelled as if it were the selected live source.
  const { emoji, label } = liveDataUnavailable
    ? { emoji: '🔴', label: 'NO LIVE READING' }
    : activeProvider === 'atc'
      ? usingFallback
        // internetProviderDisplayName (WeatherContext.tsx) is already
        // the complete display string ("Met-Office SAWS" or bare
        // "Met-Office", server-derived - see that context's own
        // comment) - rendered verbatim, no further formatting here. No
        // provider check needed here (unlike the 'internet' branch
        // below) - the ATC fallback always calls fetchInternetWeather(),
        // which is always Open-Meteo, never a different registered
        // provider.
        ? { emoji: '🔵', label: internetProviderDisplayName }
        : { emoji: '🟢', label: 'LIVE ATC' }
      : activeProvider === 'internet'
        ? {
            emoji: '🔵',
            // Deliberately identical to the ATC-fallback badge above -
            // same label regardless of whether this source is showing
            // because of automatic fallback or a manual /config
            // selection, since it's the same underlying data either
            // way. Override only applies when Open-Meteo is the
            // actually-selected internet provider - a guard against a
            // future second INTERNET_WEATHER_PROVIDERS entry silently
            // inheriting a label that's specifically about Open-Meteo's
            // own Met-Office-sourced UK data.
            label:
              config.internet.provider === 'open-meteo'
                ? internetProviderDisplayName
                : INTERNET_WEATHER_PROVIDERS[config.internet.provider].label,
          }
        : // Weather-share round: 'ingested' via an active cross-tenant share
          // (weather.sourceTenantName only ever set in that case - see
          // WeatherData's own comment) names the actual source instead of
          // the generic "Third-Party Station" label below, which told the
          // viewer nothing. Genuinely ATC-captured data (sourceReadingType
          // 'atc_capture') gets the SAME green live-ATC treatment Shobdon's
          // own dashboard uses for its own station - it IS a live ATC
          // reading, just physically captured at another tenant's site.
          // Anything else (the source tenant's own internet/third-party
          // feed, shared onward) keeps the purple "not a physical station"
          // treatment, just naming who it's from instead of staying
          // generic - never claim ATC for a reading that isn't one.
          activeProvider === 'ingested' && weather?.sourceTenantName
          ? weather.sourceReadingType === 'atc_capture'
            ? { emoji: '🟢', label: `${firstWordUpper(weather.sourceTenantName)} ATC` }
            : { emoji: '🟣', label: `SHARED: ${firstWordUpper(weather.sourceTenantName)}` }
          : STATUS_BY_PROVIDER[activeProvider]

  return (
    <div className="flex items-center gap-2 text-base font-bold tracking-wide text-slate-200">
      <span aria-hidden="true">{emoji}</span>
      <span>{label}</span>
    </div>
  )
}
