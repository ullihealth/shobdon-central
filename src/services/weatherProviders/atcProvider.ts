import type { WeatherProviderFetcher } from './types'
import type { WeatherData } from '../../types/weather'
import { fetchWithTimeout } from '../fetchWithTimeout'

/**
 * The Davis Vantage Pro 2 (via WeatherLink) exposes a local status page at
 * `adisp.php`, but its exact response shape hasn't been captured yet. This
 * function is the single place that needs real parsing logic once a sample
 * is available - everything else in the app already goes through this
 * provider via the WeatherConfig-driven registry.
 */
function parseAdispResponse(raw: string): WeatherData {
  throw new Error(`adisp.php response format not yet implemented (received ${raw.length} bytes)`)
}

export const fetchAtcWeather: WeatherProviderFetcher = async (config) => {
  const response = await fetchWithTimeout(config.atc.stationUrl, config.atc.connectionTimeoutMs)
  if (!response.ok) {
    throw new Error(`Weather station responded with ${response.status}`)
  }
  const raw = await response.text()
  return { data: parseAdispResponse(raw), live: true }
}
