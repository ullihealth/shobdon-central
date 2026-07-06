import { WEATHER_STATION_URL, WEATHER_POLL_INTERVAL_MS } from '../config/weatherStation'
import type { WeatherConfig } from '../types/weatherConfig'

const STORAGE_KEY = 'shobdon-central.weather-config.v1'

// Shobdon Aerodrome coordinates - used as the default Internet Weather location.
export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  activeProvider: 'mock',
  atc: {
    stationUrl: WEATHER_STATION_URL,
    refreshIntervalSeconds: WEATHER_POLL_INTERVAL_MS / 1000,
    connectionTimeoutMs: 5000,
  },
  internet: {
    provider: 'open-meteo',
    latitude: 52.2416,
    longitude: -2.8821,
    refreshIntervalSeconds: 30,
  },
}

export function loadWeatherConfig(): WeatherConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WEATHER_CONFIG

    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_WEATHER_CONFIG,
      ...parsed,
      atc: { ...DEFAULT_WEATHER_CONFIG.atc, ...parsed.atc },
      internet: { ...DEFAULT_WEATHER_CONFIG.internet, ...parsed.internet },
    }
  } catch {
    return DEFAULT_WEATHER_CONFIG
  }
}

export function saveWeatherConfig(config: WeatherConfig): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}
