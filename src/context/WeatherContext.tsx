import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchWeatherData } from '../services/weatherService'
import { fetchAtcWeather } from '../services/weatherProviders/atcProvider'
import { fetchMetOfficeFallbackWeather } from '../services/weatherProviders/metOfficeFallbackProvider'
import { fetchMockWeather } from '../services/weatherProviders/mockProvider'
import { DEFAULT_WEATHER_CONFIG, resolveWeatherConfig } from '../services/weatherConfigStore'
import type { WeatherData, WeatherSource } from '../types/weather'
import type { WeatherConfig, WeatherProviderId } from '../types/weatherConfig'

interface WeatherContextValue {
  weather: WeatherData | null
  source: WeatherSource
  loading: boolean
  activeProvider: WeatherProviderId
  config: WeatherConfig
  // True when the admin deliberately selected a real source (atc/internet)
  // but the fetch failed and silently substituted mock data - as opposed
  // to Mock being the intentionally selected provider, where source
  // 'mock' is expected and not a failure. Consumers use this to show
  // "no live reading" instead of rendering the substituted mock numbers
  // as if they were real.
  liveDataUnavailable: boolean
  // True when activeProvider is 'atc' but the reading currently on screen
  // actually came from the Met Office DataHub auto-fallback, not the ATC
  // station - see the ATC-primary/internet-fallback state machine below.
  // Always false for every other activeProvider (this is specifically an
  // 'atc' behaviour, not a general "not live" flag - liveDataUnavailable
  // above already covers "neither source worked").
  usingFallback: boolean
  // Manual override for WeatherStatusIndicator's "Reconnect now" action -
  // clears the pinned-to-fallback state and immediately retries ATC,
  // rather than waiting for the next scheduled recheck. A no-op unless
  // activeProvider is 'atc' and a fallback is actually active.
  reconnectToAtc: () => void
}

const DEFAULT_REFRESH_INTERVAL_SECONDS = 30

// Requirement's own "every 5 minutes (configurable constant)" - used both
// as the recheck cadence while auto-reconnect is on (retry ATC on this
// schedule) and as the fallback data's own refresh cadence while pinned
// with auto-reconnect off (Met Office's hourly forecast doesn't need
// tighter polling than this either way).
const FALLBACK_RECHECK_INTERVAL_SECONDS = 5 * 60

function refreshIntervalSecondsFor(config: WeatherConfig): number {
  switch (config.activeProvider) {
    case 'atc':
      return config.atc.refreshIntervalSeconds
    case 'internet':
      return config.internet.refreshIntervalSeconds
    default:
      return DEFAULT_REFRESH_INTERVAL_SECONDS
  }
}

const WeatherContext = createContext<WeatherContextValue | undefined>(undefined)

interface WeatherProviderProps {
  children: ReactNode
  // Overrides the persisted config instead of resolving it. Used by the
  // /design preview so it always shows mock data, regardless of
  // whatever weather source is currently configured for the real dashboard.
  forcedConfig?: WeatherConfig
}

export function WeatherProvider({ children, forcedConfig }: WeatherProviderProps): JSX.Element {
  // Starts null (not synchronously loaded) - resolveWeatherConfig() may
  // need one network round-trip for a device that's never been
  // configured (see weatherConfigStore.ts). An already-configured
  // device (e.g. Shobdon's own kiosks) resolves on the next microtask
  // with no network call at all, so this adds no visible delay there -
  // the page already showed a loading state before its first weather
  // fetch resolved anyway.
  const [config, setConfig] = useState<WeatherConfig | null>(forcedConfig ?? null)
  // liveDataUnavailable excluded here (pre-existing gap, not introduced
  // by this change - confirmed present before this file's rewrite): it's
  // a value COMPUTED below from config + value.source, never itself part
  // of a setValue(...) object literal, same category as usingFallback/
  // reconnectToAtc which were already excluded.
  const [value, setValue] = useState<
    Omit<WeatherContextValue, 'activeProvider' | 'config' | 'usingFallback' | 'reconnectToAtc' | 'liveDataUnavailable'>
  >({
    weather: null,
    source: 'mock',
    loading: true,
  })
  const [usingFallback, setUsingFallback] = useState(false)
  // Session-local, not persisted - a page reload naturally re-attempts
  // ATC first and re-detects staleness within one fetch (a few seconds)
  // if it's still down, so there's no real benefit to remembering
  // "we were pinned" across a reload, only extra state to keep in sync.
  const pinnedToFallbackRef = useRef(false)
  // Bumped by reconnectToAtc() to restart the ATC-branch effect below
  // immediately (cancelling any pending 5-minute recheck timeout)
  // instead of waiting for its next scheduled tick.
  const [manualReconnectSignal, setManualReconnectSignal] = useState(0)

  useEffect(() => {
    if (forcedConfig) return
    let cancelled = false
    resolveWeatherConfig().then((resolved) => {
      if (!cancelled) setConfig(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [forcedConfig])

  // Unchanged path for every non-'atc' provider (internet/ingested/mock) -
  // exactly the original single fetchWeatherData() + fixed-interval poll,
  // deliberately untouched so none of those already-working paths change
  // behaviour at all. The ATC-primary/internet-fallback auto-switch below
  // is specifically an 'atc' concern - a manually-selected 'internet'
  // provider is the admin's own deliberate choice, not something this
  // feature should second-guess or fall back away from.
  useEffect(() => {
    if (!config || config.activeProvider === 'atc') return
    let cancelled = false

    async function load() {
      const { data, source } = await fetchWeatherData(config as WeatherConfig)
      if (!cancelled) {
        setValue({ weather: data, source, loading: false })
        setUsingFallback(false)
      }
    }

    load()
    const interval = window.setInterval(load, refreshIntervalSecondsFor(config) * 1000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [config])

  // ATC-primary / Met Office DataHub-fallback auto-switch. Self-
  // rescheduling setTimeout chain rather than a fixed setInterval,
  // because the polling cadence itself changes with state: normal
  // operation polls at atc.refreshIntervalSeconds (~60s), but once
  // pinned to fallback it polls at the much slower
  // FALLBACK_RECHECK_INTERVAL_SECONDS (5 min) instead - a fixed interval
  // can't express that without either hammering ATC every ~60s while
  // it's known-down, or leaving the dashboard on stale fallback data for
  // up to a full normal cycle after it recovers.
  //
  // State machine per tick:
  // - pinned + auto-reconnect OFF: skip ATC entirely (the whole point of
  //   the toggle - don't even attempt recovery), just refresh the
  //   fallback reading, recheck again in 5 minutes.
  // - not pinned, OR pinned + auto-reconnect ON (this tick IS the
  //   recheck): try ATC first.
  //   - succeeds: use it, un-pin, resume the normal ~60s cadence.
  //   - fails: pin (if not already), use the Met Office fallback,
  //     recheck again in 5 minutes.
  // - if BOTH ATC and the fallback fail: same emergency floor
  //   weatherService.fetchWeatherData already uses everywhere else -
  //   substitute mock data, source 'mock', liveDataUnavailable becomes
  //   true via the existing computed flag below (unchanged formula).
  useEffect(() => {
    if (!config || config.activeProvider !== 'atc') return
    let cancelled = false
    let timeoutId: number | undefined

    function scheduleNext(seconds: number) {
      if (cancelled) return
      timeoutId = window.setTimeout(tick, seconds * 1000)
    }

    async function useFallback() {
      try {
        const result = await fetchMetOfficeFallbackWeather()
        if (!cancelled) {
          setValue({ weather: result.data, source: 'live', loading: false })
          setUsingFallback(true)
        }
      } catch (fallbackError) {
        console.warn('Met Office DataHub fallback failed, falling back to mock:', fallbackError)
        const mockResult = await fetchMockWeather(config as WeatherConfig)
        if (!cancelled) {
          setValue({ weather: mockResult.data, source: 'mock', loading: false })
          setUsingFallback(true)
        }
      }
    }

    async function tick() {
      if (cancelled) return
      const currentConfig = config as WeatherConfig

      if (pinnedToFallbackRef.current && !currentConfig.atc.autoReconnectEnabled) {
        await useFallback()
        scheduleNext(FALLBACK_RECHECK_INTERVAL_SECONDS)
        return
      }

      try {
        const result = await fetchAtcWeather(currentConfig)
        if (!cancelled) {
          setValue({ weather: result.data, source: 'live', loading: false })
          setUsingFallback(false)
        }
        pinnedToFallbackRef.current = false
        scheduleNext(currentConfig.atc.refreshIntervalSeconds)
      } catch (atcError) {
        console.warn('ATC weather provider failed/stale, switching to Met Office DataHub fallback:', atcError)
        pinnedToFallbackRef.current = true
        await useFallback()
        scheduleNext(FALLBACK_RECHECK_INTERVAL_SECONDS)
      }
    }

    tick()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [config, manualReconnectSignal])

  function reconnectToAtc() {
    pinnedToFallbackRef.current = false
    setManualReconnectSignal((n) => n + 1)
  }

  const liveDataUnavailable = !!config && config.activeProvider !== 'mock' && value.source === 'mock'

  return (
    <WeatherContext.Provider
      value={{
        ...value,
        activeProvider: config?.activeProvider ?? DEFAULT_WEATHER_CONFIG.activeProvider,
        config: config ?? DEFAULT_WEATHER_CONFIG,
        liveDataUnavailable,
        usingFallback,
        reconnectToAtc,
      }}
    >
      {children}
    </WeatherContext.Provider>
  )
}

export function useWeather(): WeatherContextValue {
  const context = useContext(WeatherContext)
  if (!context) {
    throw new Error('useWeather must be used within a WeatherProvider')
  }
  return context
}
