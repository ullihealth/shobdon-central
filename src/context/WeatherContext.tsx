import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchWeatherData } from '../services/weatherService'
import { fetchAtcWeather } from '../services/weatherProviders/atcProvider'
import { fetchInternetWeather } from '../services/weatherProviders/internetProvider'
import { fetchMockWeather } from '../services/weatherProviders/mockProvider'
import { DEFAULT_WEATHER_CONFIG, resolveWeatherConfig, fetchServerActiveProvider, saveWeatherConfig } from '../services/weatherConfigStore'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
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
  // True once STALE_WARNING_THRESHOLD_MS has passed since the last
  // successful setValue() of ANY kind (live or mock-substituted) - a
  // "is the poll loop actually still ticking at all" safety net,
  // deliberately independent of liveDataUnavailable/usingFallback/
  // activeProvider. Those flags describe whether the STATE MACHINE
  // currently believes a source is working; this describes whether the
  // state machine has updated ANYTHING recently, which is exactly the
  // signal that's still meaningful if the state machine's own timers
  // silently stopped firing (backgrounded-tab throttling, a stuck
  // effect, etc.) - the class of bug this whole round exists to guard
  // against. See Pilot View's own "Pull to Refresh" banner, the only
  // current consumer.
  dataStale: boolean
  // Per-tenant override (migration 0083, internet_provider_display_name)
  // for how the Open-Meteo internet-weather source is named - "Open-Meteo"
  // by default, "Met-Office" for tenants whose weather setup is tied to
  // Shobdon's own ATC/PC2 station (Open-Meteo's UK data is itself
  // Met-Office-sourced, so this is factual for those tenants, not just
  // branding). WeatherStatusIndicator.tsx's own two badges both read
  // this rather than the static INTERNET_WEATHER_PROVIDERS registry
  // label directly - that registry only ever describes the underlying
  // fetch mechanism (always Open-Meteo), never the tenant-facing name.
  internetProviderDisplayName: string
}

// Generic fallback when a tenant has no override recorded - matches
// INTERNET_WEATHER_PROVIDERS['open-meteo'].label (internetProviders/
// index.ts), not re-imported from there to avoid a dependency between
// this context and that registry purely for a shared string literal.
const DEFAULT_INTERNET_PROVIDER_DISPLAY_NAME = 'Open-Meteo'

// Comfortably larger than either normal polling cadence (atc.refresh
// IntervalSeconds, ~30s default, or FALLBACK_RECHECK_INTERVAL_SECONDS's
// 5-minute pinned cadence below) - NOT the same as atcProvider.ts's own
// STALE_THRESHOLD_MS (2 minutes), which is a narrower, different check
// (is ONE ATC reading fresh enough to accept at all, tied to PC2's own
// ~60s capture cadence). Reusing that 2-minute value here would
// false-positive constantly during completely normal fallback-pinned
// operation, which only rechecks every 5 minutes by design. 10 minutes
// gives a full buffer cycle over that 5-minute cadence before this
// starts treating anything as suspicious.
const STALE_WARNING_THRESHOLD_MS = 10 * 60 * 1000
// Two jobs share this one interval, not two separate timers - see the
// effect below. (1) How often dataStale is re-evaluated even if nothing
// else happens - without this, a genuinely stuck poll loop
// (lastUpdatedAt frozen) would never trigger a re-render to actually
// reveal the staleness; time passing alone doesn't cause React to
// re-render on its own. (2) How often activeProvider itself is
// re-checked against the server (migration 0082's shared selection) -
// previously that only happened on mount or an explicit refetchNow()
// (pull-to-refresh, pageshow, touch, online/visibilitychange), so a
// provider change made on another device sat unnoticed on an already-
// open, otherwise-idle device until one of those fired. Comparable to
// the normal weather-data polling cadence (~30-60s) by design, so a
// provider change now propagates on roughly the same timeframe weather
// data itself already does, with no new interval/infrastructure added.
const PERIODIC_CHECK_INTERVAL_MS = 30 * 1000

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
  // Stamped on every successful setValue() below (all four call sites,
  // live or mock alike - see setValueAndStamp) - see dataStale's own
  // comment on WeatherContextValue for why mock substitutions count
  // too. null until the very first fetch resolves; dataStale is always
  // false while null (see below) - "no data yet" isn't "stale data".
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  // Forces a periodic re-render purely so dataStale (computed fresh on
  // every render from Date.now() - lastUpdatedAt) actually gets
  // re-evaluated on a schedule, not just whenever some unrelated state
  // change happens to cause a render anyway.
  const [, setPeriodicCheckTick] = useState(0)

  // Every place below that would otherwise call setValue(...) directly
  // calls this instead - single choke point so lastUpdatedAt can never
  // drift out of sync with an actual successful update by a forgotten
  // call site.
  function setValueAndStamp(next: typeof value) {
    setValue(next)
    setLastUpdatedAt(Date.now())
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPeriodicCheckTick((t) => t + 1)

      // Piggybacks on this same tick rather than a new interval (see
      // PERIODIC_CHECK_INTERVAL_MS's own comment). fetchServerActiveProvider
      // already has its own retry (weatherConfigStore.ts) so a single
      // dropped request here doesn't matter - it just tries again on the
      // next tick regardless. The functional setConfig form below reads
      // the LATEST config at call time (no stale closure despite this
      // effect's empty dependency array) and only actually replaces it
      // (triggering the data-fetching effects that depend on config) when
      // the provider genuinely changed - every other tick is a no-op past
      // the fetch itself, not a spurious extra weather refetch.
      fetchServerActiveProvider().then((serverProvider) => {
        if (!serverProvider) return
        setConfig((prev) => {
          if (!prev || prev.activeProvider === serverProvider) return prev
          const next = { ...prev, activeProvider: serverProvider }
          try {
            saveWeatherConfig(next)
          } catch {
            // Non-critical cache write - next is still applied either way.
          }
          return next
        })
      })
    }, PERIODIC_CHECK_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  const [internetProviderDisplayName, setInternetProviderDisplayName] = useState(DEFAULT_INTERNET_PROVIDER_DISPLAY_NAME)

  // Mount-once, no retry/polling (unlike activeProvider above) - this is
  // a developer-set, essentially-static per-tenant naming override
  // (migration 0083), not an operational setting an admin changes at
  // runtime, so there's no real-time-sync requirement here the way
  // there is for activeProvider. A failed/slow fetch just leaves the
  // generic "Open-Meteo" default in place rather than blocking on retry.
  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { internetProviderDisplayName?: unknown } | null) => {
        const value = data?.internetProviderDisplayName
        if (!cancelled && typeof value === 'string' && value.trim()) {
          setInternetProviderDisplayName(value.trim())
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
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
        setValueAndStamp({ weather: data, source, loading: false })
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
          setValueAndStamp({ weather: result.data, source: result.live ? 'live' : 'mock', loading: false })
          setUsingFallback(true)
        }
      } catch (fallbackError) {
        console.warn('Internet-weather fallback failed, falling back to mock:', fallbackError)
        const mockResult = await fetchMockWeather(currentConfig)
        if (!cancelled) {
          setValueAndStamp({ weather: mockResult.data, source: 'mock', loading: false })
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
          setValueAndStamp({ weather: result.data, source: 'live', loading: false })
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
  //
  // Re-resolves config (async, awaited) BEFORE bumping the signal - this
  // is what makes a manual refresh pick up a provider change made on a
  // DIFFERENT device via /config (migration 0082's server-side
  // activeWeatherProvider - see weatherConfigStore.ts's own comment on
  // resolveWeatherConfig for the full fix). Deliberately not just
  // fetchServerActiveProvider() inline here - reusing the exact same
  // resolveWeatherConfig() the mount effect above already calls means
  // there's only one place that knows how to merge a server override
  // onto a local config. setConfig and setManualReconnectSignal below
  // both land in the same React commit (both set from the same
  // already-resolved promise, not two separate awaits), so the two
  // data-fetching effects above only re-run ONCE per refetchNow() call,
  // already against the up-to-date config - not once against the stale
  // config and then again moments later against the fresh one.
  async function refetchNow() {
    pinnedToFallbackRef.current = false
    if (!forcedConfig) {
      const resolved = await resolveWeatherConfig()
      setConfig(resolved)
    }
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
  const dataStale = lastUpdatedAt !== null && Date.now() - lastUpdatedAt > STALE_WARNING_THRESHOLD_MS

  return (
    <WeatherContext.Provider
      value={{
        ...value,
        activeProvider: config?.activeProvider ?? DEFAULT_WEATHER_CONFIG.activeProvider,
        config: config ?? DEFAULT_WEATHER_CONFIG,
        liveDataUnavailable,
        usingFallback,
        refetchNow,
        dataStale,
        internetProviderDisplayName,
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
