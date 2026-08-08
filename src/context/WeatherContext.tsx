import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchWeatherData } from '../services/weatherService'
import { fetchAtcWeather } from '../services/weatherProviders/atcProvider'
import { fetchInternetWeather } from '../services/weatherProviders/internetProvider'
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
  // actually came from the internet-weather auto-fallback (Open-Meteo,
  // the same fetchInternetWeather() a manually-selected 'internet'
  // provider already uses - see useFallback() below), not the ATC
  // station - see the ATC-primary/internet-fallback state machine below.
  // Always false for every other activeProvider (this is specifically an
  // 'atc' behaviour, not a general "not live" flag - liveDataUnavailable
  // above already covers "neither source worked").
  usingFallback: boolean
  // "Refetch weather right now" for any activeProvider, not just 'atc' -
  // used by Pilot View's pull-to-refresh (a guaranteed manual backstop)
  // and this context's own online/visibilitychange listeners (automatic
  // recovery after connectivity loss or a backgrounded tab). Used to
  // also be exposed under a second name, reconnectToAtc, for
  // WeatherStatusIndicator's own "Reconnect now" button - removed along
  // with that button (redundant everywhere: /pilot already has pull-to-
  // refresh calling this same function, and the desktop TV/kiosk
  // dashboard has no pointer to click a button with in the first place).
  refetchNow: () => void
}

const DEFAULT_REFRESH_INTERVAL_SECONDS = 30

// Requirement's own "every 5 minutes (configurable constant)" - used both
// as the recheck cadence while auto-reconnect is on (retry ATC on this
// schedule) and as the fallback data's own refresh cadence while pinned
// with auto-reconnect off (Open-Meteo's own forecast data doesn't need
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
  // of a setValue(...) object literal, same category as usingFallback
  // which is already excluded.
  const [value, setValue] = useState<
    Omit<WeatherContextValue, 'activeProvider' | 'config' | 'usingFallback' | 'liveDataUnavailable'>
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
  // Bumped by refetchNow() to restart the ATC-branch effect below
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
    // manualReconnectSignal included so refetchNow() (external callers -
    // Pilot View's pull-to-refresh, and the online/visibilitychange
    // listeners below) forces an immediate reload+interval-reset here too,
    // not just on the ATC branch below - bumping it re-runs this whole
    // effect (cleanup + immediate load() + fresh interval), same
    // mechanism, no separate signal needed for this branch.
  }, [config, manualReconnectSignal])

  // ATC-primary / internet-weather-fallback auto-switch. Self-
  // rescheduling setTimeout chain rather than a fixed setInterval,
  // because the polling cadence itself changes with state: normal
  // operation polls at atc.refreshIntervalSeconds (~60s), but once
  // pinned to fallback it polls at the much slower
  // FALLBACK_RECHECK_INTERVAL_SECONDS (5 min) instead - a fixed interval
  // can't express that without either hammering ATC every ~60s while
  // it's known-down, or leaving the dashboard on stale fallback data for
  // up to a full normal cycle after it recovers.
  //
  // useFallback() calls fetchInternetWeather(currentConfig) - the exact
  // same Open-Meteo fetch a manually-selected 'internet' provider
  // already uses (see the other data-fetching effect above) - not the
  // separate, unregistered Met Office DataHub proxy this used to call.
  // That proxy has its own real-world upstream rate limit (confirmed
  // live: Met Office DataHub returning 429 during a real outage) and
  // was never actually reachable through this app's own manually-
  // selectable "Internet Weather" option, so a working manual fallback
  // and a broken automatic one could disagree with each other - exactly
  // what was observed. Reusing fetchInternetWeather here means the
  // automatic cascade and the manual "Internet Weather" selection are
  // now backed by the literal same function call, so they can't drift
  // apart like this again.
  //
  // State machine per tick:
  // - pinned + auto-reconnect OFF: skip ATC entirely (the whole point of
  //   the toggle - don't even attempt recovery), just refresh the
  //   fallback reading, recheck again in 5 minutes.
  // - not pinned, OR pinned + auto-reconnect ON (this tick IS the
  //   recheck): try ATC first.
  //   - succeeds: use it, un-pin, resume the normal ~60s cadence.
  //   - fails: pin (if not already), use the internet-weather fallback,
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

    async function useFallback(currentConfig: WeatherConfig) {
      try {
        const result = await fetchInternetWeather(currentConfig)
        if (!cancelled) {
          setValue({ weather: result.data, source: result.live ? 'live' : 'mock', loading: false })
          setUsingFallback(true)
        }
      } catch (fallbackError) {
        console.warn('Internet-weather fallback failed, falling back to mock:', fallbackError)
        const mockResult = await fetchMockWeather(currentConfig)
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
        await useFallback(currentConfig)
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
        console.warn('ATC weather provider failed/stale, switching to internet-weather fallback:', atcError)
        pinnedToFallbackRef.current = true
        await useFallback(currentConfig)
        scheduleNext(FALLBACK_RECHECK_INTERVAL_SECONDS)
      }
    }

    tick()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [config, manualReconnectSignal])

  // Bumping manualReconnectSignal restarts BOTH data-fetching effects
  // above immediately (each is gated on config.activeProvider, so only
  // whichever one is actually active reacts), and resetting
  // pinnedToFallbackRef is a harmless no-op for a non-'atc' provider.
  // Used by Pilot View's pull-to-refresh and the online/visibilitychange
  // listeners just below - was also exposed as reconnectToAtc for
  // WeatherStatusIndicator's own "Reconnect now" button, removed along
  // with that button (see this context value's own comment).
  function refetchNow() {
    pinnedToFallbackRef.current = false
    setManualReconnectSignal((n) => n + 1)
  }

  // Reconnect-after-connectivity-loss / tab-refocus round: forces an
  // immediate refetch (via refetchNow, bypassing whatever's left of
  // either data-fetching effect's own timer) the moment the device
  // regains network or this tab becomes visible again. Closes a real
  // gap: a backgrounded tab's setTimeout/setInterval chain is prone to
  // being throttled or fully frozen by the OS while inactive (most
  // aggressively in standalone/home-screen mode, exactly Pilot View's
  // own install path) - without this, recovering from something like an
  // overnight airplane-mode toggle depended entirely on a timer that may
  // not have been running at all while backgrounded. Always attempts to
  // re-establish ATC-primary when pinned to fallback, even with
  // autoReconnectEnabled off - see this round's own discussion: a
  // genuine reconnect/refocus signal is meaningfully different from a
  // routine ~60s timer tick (which that toggle exists to avoid
  // hammering ATC with), so it's always worth one retry rather than
  // silently deferring to the toggle. Mount-once (empty deps) -
  // refetchNow's own body has no stale-closure risk (it only touches a
  // stable setState setter and a ref), so it's safe to capture once.
  useEffect(() => {
    function handleOnline() {
      refetchNow()
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') refetchNow()
    }
    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  const liveDataUnavailable = !!config && config.activeProvider !== 'mock' && value.source === 'mock'

  return (
    <WeatherContext.Provider
      value={{
        ...value,
        activeProvider: config?.activeProvider ?? DEFAULT_WEATHER_CONFIG.activeProvider,
        config: config ?? DEFAULT_WEATHER_CONFIG,
        liveDataUnavailable,
        usingFallback,
        refetchNow,
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
