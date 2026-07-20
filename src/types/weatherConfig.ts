export type WeatherProviderId = 'atc' | 'internet' | 'ingested' | 'mock'

// Future internet providers (e.g. 'aviationweather', 'custom') extend this union;
// the internet provider registry is the only place that needs to grow.
export type InternetWeatherProviderId = 'open-meteo'

export interface AtcConfig {
  stationUrl: string
  refreshIntervalSeconds: number
  connectionTimeoutMs: number
  // When the ATC capture is stale/unreachable, WeatherContext auto-
  // switches to the Met Office DataHub fallback (see WeatherContext.tsx's
  // own comment on the full state machine). true (default): once the
  // ATC capture is fresh again, auto-switch back to it. false: stay on
  // the fallback until manually reconnected (WeatherStatusIndicator's
  // "Reconnect now" action), even if ATC recovers on its own - for a
  // known extended outage where flapping back and forth on an
  // intermittently-recovering feed would be worse than just staying put.
  autoReconnectEnabled: boolean
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
