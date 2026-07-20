import type { WeatherData } from '../../types/weather'
import { MET_OFFICE_WEATHER_URL } from '../../config/publicApi'

/**
 * ATC-primary/internet-fallback auto-switch's fallback source (see
 * WeatherContext.tsx's own comment on the full state machine) - Met
 * Office Weather DataHub, proxied server-side by
 * functions/api/public/weather-metoffice.ts (holds the real API key;
 * this is a same-origin fetch with nothing secret in it, same shape as
 * atcProvider.ts's own LATEST_READING_URL call).
 *
 * Deliberately NOT registered in weatherProviders/index.ts's
 * WEATHER_PROVIDERS or internetProviders/index.ts's
 * INTERNET_WEATHER_PROVIDERS - this isn't a manually-selectable "Weather
 * Source" option (selecting it directly would bypass the whole
 * ATC-primary/fallback point), it's only ever invoked internally by
 * WeatherContext's own auto-switch logic when the 'atc' provider is
 * stale/unreachable.
 */
export async function fetchMetOfficeFallbackWeather(): Promise<{ data: WeatherData; live: boolean }> {
  const response = await fetch(MET_OFFICE_WEATHER_URL)
  if (!response.ok) {
    throw new Error(`Met Office DataHub fallback proxy responded with ${response.status}`)
  }

  const json = await response.json()
  if (
    typeof json?.windSpeed !== 'number' ||
    typeof json?.windDirection !== 'number' ||
    typeof json?.temperature !== 'number' ||
    typeof json?.qnh !== 'number'
  ) {
    throw new Error('Met Office DataHub fallback proxy returned an incomplete reading')
  }

  const data: WeatherData = {
    windSpeed: json.windSpeed,
    windDirection: json.windDirection,
    windGust: typeof json.windGust === 'number' ? json.windGust : undefined,
    temperature: json.temperature,
    qnh: json.qnh,
    pressureTrend: json.pressureTrend === 'rising' || json.pressureTrend === 'falling' ? json.pressureTrend : 'steady',
    notams: [],
  }

  return { data, live: true }
}
