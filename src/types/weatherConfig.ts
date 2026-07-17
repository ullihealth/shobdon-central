export type WeatherProviderId = 'atc' | 'internet' | 'ingested' | 'mock'

// Future internet providers (e.g. 'aviationweather', 'custom') extend this union;
// the internet provider registry is the only place that needs to grow.
export type InternetWeatherProviderId = 'open-meteo'

export interface AtcConfig {
  stationUrl: string
  refreshIntervalSeconds: number
  connectionTimeoutMs: number
}

export interface InternetConfig {
  provider: InternetWeatherProviderId
  latitude: number
  longitude: number
  refreshIntervalSeconds: number
}

export interface WeatherConfig {
  activeProvider: WeatherProviderId
  atc: AtcConfig
  internet: InternetConfig
}
