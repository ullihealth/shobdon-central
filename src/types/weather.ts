export type PressureTrend = 'rising' | 'falling' | 'steady'

export interface WeatherData {
  windSpeed: number // knots
  windDirection: number // degrees, 0-360
  windGust?: number // knots
  temperature: number // Celsius
  qnh: number // hPa
  pressureTrend: PressureTrend
  notams: string[] // active NOTAM text(s); empty array means genuinely none, not "unknown"
}

// 'mock' means the station could not be reached or its response could not
// yet be parsed; the UI should treat 'live' as the only trustworthy source.
export type WeatherSource = 'live' | 'mock'
