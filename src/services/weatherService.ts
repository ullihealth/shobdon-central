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
  } catch (error) {
    // Falling back silently made a real provider failure indistinguishable
    // from working-as-intended for a long time - logging the reason here
    // costs nothing and is the fastest way to tell the two apart from
    // devtools alone.
    console.warn(`Weather provider "${config.activeProvider}" failed, falling back to mock:`, error)
    const fallback = await fetchMockWeather(config)
    return { data: fallback.data, source: 'mock' }
  }
}
