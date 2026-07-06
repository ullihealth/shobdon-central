import type { WeatherConfig } from '../../types/weatherConfig'
import type { WeatherData } from '../../types/weather'

export interface WeatherProviderFetchResult {
  data: WeatherData
  live: boolean
}

export type WeatherProviderFetcher = (config: WeatherConfig) => Promise<WeatherProviderFetchResult>
