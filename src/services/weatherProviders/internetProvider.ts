import type { WeatherProviderFetcher } from './types'
import { INTERNET_WEATHER_PROVIDERS } from '../internetProviders'

export const fetchInternetWeather: WeatherProviderFetcher = async (config) => {
  const provider = INTERNET_WEATHER_PROVIDERS[config.internet.provider]
  return provider.fetch(config)
}
