import type { WeatherData } from '../types/weather'
import type { WeatherProviderId } from '../types/weatherConfig'

// Standard aviation approximation: cloud base (ft AGL) = 400 x (temp_c - dewpoint_c).
// A genuine estimate from a real station's temp/dewpoint spread, not a
// measured ceiling - callers are responsible for labelling it as such.
export function estimateCloudBaseFt(temperatureC: number, dewpointC: number): number {
  return Math.round(400 * (temperatureC - dewpointC))
}

// Shared gate for the "Cloud Base (Shobdon Calculated)" card, previously
// duplicated (identically) across WeatherStatGrid.tsx, LeftInfoPanel.tsx,
// Clubhouse2Template.tsx and ForecastCloudbaseCluster.tsx as
// `activeProvider !== 'atc' || weather.dewpoint === undefined`. That gate
// meant an 'ingested' subtenant reading a physical-ATC tenant's own
// shared feed (e.g. Gyroplane Train reading Shobdon's) always showed
// "N/A" even though the forwarded reading genuinely carries a real
// dewpoint (ingestedProvider.ts's own `dewpoint: reading.dewpointC ??
// undefined` mapping, confirmed against a live reading) - the qualifier
// is "Shobdon Calculated", not "atc-provider-only Calculated", so a
// subtenant seeing Shobdon's own genuine station data should see the
// same calculated value Shobdon's own page does.
//
// Extended, not loosened: still false for 'ingested' when
// sourceReadingType is 'met_office_fallback' (the station-owning
// tenant's own outage-substituted Open-Meteo reading, not a real station
// measurement - same reasoning WeatherStatusIndicator.tsx's own
// atc_capture-vs-met_office_fallback branch already uses) or anything
// else ('internet'/'third_party_api', a subtenant's own genuine
// non-ATC feed). Shobdon's own 'atc' branch is completely untouched -
// this only ever ADDS a case, never changes what was already shown for
// the station-owning tenant's own page.
export function resolveCloudBaseFt(
  weather: Pick<WeatherData, 'temperature' | 'dewpoint' | 'sourceReadingType'> | null | undefined,
  liveDataUnavailable: boolean,
  activeProvider: WeatherProviderId
): number | null {
  if (!weather || liveDataUnavailable || weather.dewpoint === undefined) return null
  const isGenuineAtcReading = activeProvider === 'atc' || (activeProvider === 'ingested' && weather.sourceReadingType === 'atc_capture')
  return isGenuineAtcReading ? estimateCloudBaseFt(weather.temperature, weather.dewpoint) : null
}
