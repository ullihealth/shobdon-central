export type PressureTrend = 'rising' | 'falling' | 'steady'

export interface WeatherData {
  windSpeed: number // knots
  windDirection: number // degrees, 0-360
  windGust?: number // knots
  temperature: number // Celsius
  qnh: number // hPa
  pressureTrend: PressureTrend
  notams: string[] // active NOTAM text(s); empty array means genuinely none, not "unknown"
  // Only ever populated by the 'atc' provider (Shobdon's own Vantage Pro2
  // station) - undefined for mock/internet, which have no dewpoint source.
  // Powers the Cloud Base (Shobdon Calculated) card; a missing value means
  // that card shows N/A rather than a fabricated estimate.
  dewpoint?: number // Celsius
  // ISO timestamp of when the station reading this data came from was
  // actually captured (Vantage Pro2 -> capture-weathercentral.ps1, ~60s
  // cadence) - only ever set by the 'atc' provider, same as dewpoint.
  // Powers the Cloud Base Forecast card's "Last updated" line with a
  // genuine freshness value, not the current render time.
  capturedAt?: string
}

// 'mock' means the station could not be reached or its response could not
// yet be parsed; the UI should treat 'live' as the only trustworthy source.
export type WeatherSource = 'live' | 'mock'
