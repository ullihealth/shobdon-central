import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchWeatherData } from '../services/weatherService'
import { loadWeatherConfig } from '../services/weatherConfigStore'
import type { WeatherData, WeatherSource } from '../types/weather'
import type { WeatherConfig, WeatherProviderId } from '../types/weatherConfig'

interface WeatherContextValue {
  weather: WeatherData | null
  source: WeatherSource
  loading: boolean
  activeProvider: WeatherProviderId
  config: WeatherConfig
}

const DEFAULT_REFRESH_INTERVAL_SECONDS = 30

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
  // Overrides the persisted config instead of reading it from localStorage.
  // Used by the /design preview so it always shows mock data, regardless of
  // whatever weather source is currently configured for the real dashboard.
  forcedConfig?: WeatherConfig
}

export function WeatherProvider({ children, forcedConfig }: WeatherProviderProps): JSX.Element {
  const [config] = useState<WeatherConfig>(() => forcedConfig ?? loadWeatherConfig())
  const [value, setValue] = useState<Omit<WeatherContextValue, 'activeProvider' | 'config'>>({
    weather: null,
    source: 'mock',
    loading: true,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, source } = await fetchWeatherData(config)
      if (!cancelled) {
        setValue({ weather: data, source, loading: false })
      }
    }

    load()
    const interval = window.setInterval(load, refreshIntervalSecondsFor(config) * 1000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [config])

  return (
    <WeatherContext.Provider value={{ ...value, activeProvider: config.activeProvider, config }}>
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
