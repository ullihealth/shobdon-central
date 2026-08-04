import type { WeatherData } from '../types/weather'

// Pilot View header (Section 1) - genuinely new formatting logic, no
// METAR-format string existed anywhere in this codebase before this
// round. Deliberately narrow v1: wind + QNH + temp/dewpoint groups only.
// No cloud/visibility group - cloudbase here is a CALCULATED ESTIMATE,
// not an observed cloud layer (see utils/cloudBase.ts), and including it
// would misrepresent a synthetic value as a real METAR observation. This
// is "METAR-style" shorthand, not a claim of full METAR-spec compliance
// (no CAVOK, no variable-wind handling, no visibility group).

function pad(value: number, width: number): string {
  return Math.round(Math.abs(value)).toString().padStart(width, '0')
}

// M-prefixed negative, per real METAR temperature-group convention
// (e.g. "M05" for -5°C), not a plain minus sign.
function formatTempGroup(celsius: number): string {
  return celsius < 0 ? `M${pad(celsius, 2)}` : pad(celsius, 2)
}

export function formatMetarString(weather: WeatherData | null, liveDataUnavailable: boolean): string {
  if (!weather || liveDataUnavailable) return 'N/A'

  const windDir = pad(weather.windDirection, 3)
  const windSpeed = pad(weather.windSpeed, 2)
  const gust = weather.windGust !== undefined ? `G${pad(weather.windGust, 2)}` : ''
  const windGroup = `${windDir}${windSpeed}${gust}KT`

  const qnhGroup = `Q${Math.round(weather.qnh)}`

  // dewpoint is only ever populated by the 'atc' provider (see
  // WeatherData's own comment) - omitted entirely rather than shown as
  // a fake value when absent, same "N/A means N/A" posture every other
  // panel in this app already takes.
  const tempGroup = weather.dewpoint !== undefined ? `${formatTempGroup(weather.temperature)}/${formatTempGroup(weather.dewpoint)}` : null

  return [windGroup, qnhGroup, tempGroup].filter((group): group is string => group !== null).join(' ')
}
