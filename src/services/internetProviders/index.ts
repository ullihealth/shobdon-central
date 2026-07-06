import type { InternetWeatherProviderId } from '../../types/weatherConfig'
import type { WeatherProviderFetcher } from '../weatherProviders/types'
import { fetchOpenMeteoWeather } from './openMeteo'

export interface InternetProviderDefinition {
  label: string
  fetch: WeatherProviderFetcher
}

// Adding a future provider (AviationWeather.gov, Custom, ...) is: write a
// fetch function + add one entry here. The Provider dropdown on the
// Configuration page reads this registry, so it never needs UI changes.
export const INTERNET_WEATHER_PROVIDERS: Record<InternetWeatherProviderId, InternetProviderDefinition> = {
  'open-meteo': { label: 'Open-Meteo', fetch: fetchOpenMeteoWeather },
}
