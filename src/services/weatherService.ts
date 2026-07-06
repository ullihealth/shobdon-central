import type { WeatherConfig } from '../types/weatherConfig'
import type { WeatherData, WeatherSource } from '../types/weather'
import { WEATHER_PROVIDERS } from './weatherProviders'
import { fetchMockWeather } from './weatherProviders/mockProvider'

export async function fetchWeatherData(
  config: WeatherConfig
): Promise<{ data: WeatherData; source: WeatherSource }> {
  const provider = WEATHER_PROVIDERS[config.activeProvider]

  try {
    const result = await provider.fetch(config)
    return { data: result.data, source: result.live ? 'live' : 'mock' }
  } catch {
    const fallback = await fetchMockWeather(config)
    return { data: fallback.data, source: 'mock' }
  }
}
