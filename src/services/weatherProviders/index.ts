import type { WeatherProviderId } from '../../types/weatherConfig'
import type { WeatherProviderFetcher } from './types'
import { fetchAtcWeather } from './atcProvider'
import { fetchInternetWeather } from './internetProvider'
import { fetchMockWeather } from './mockProvider'

export interface WeatherProviderDefinition {
  label: string
  fetch: WeatherProviderFetcher
}

export const WEATHER_PROVIDERS: Record<WeatherProviderId, WeatherProviderDefinition> = {
  atc: { label: 'ATC Live Weather Station', fetch: fetchAtcWeather },
  internet: { label: 'Internet Weather', fetch: fetchInternetWeather },
  mock: { label: 'Mock Data (Development)', fetch: fetchMockWeather },
}
