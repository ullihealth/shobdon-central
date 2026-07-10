import type { WeatherProviderFetcher } from './types'

const MOCK_WEATHER = {
  windSpeed: 14,
  windDirection: 250,
  windGust: 5,
  temperature: 16,
  qnh: 1013,
  pressureTrend: 'rising' as const,
  notams: [] as string[],
}

export const fetchMockWeather: WeatherProviderFetcher = async () => ({
  data: MOCK_WEATHER,
  live: false,
})
