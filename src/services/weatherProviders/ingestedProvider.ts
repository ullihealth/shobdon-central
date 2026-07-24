import type { WeatherProviderFetcher } from './types'
import type { WeatherData } from '../../types/weather'
import { INGESTED_WEATHER_LATEST_URL } from '../../config/publicApi'

/**
 * Reads the latest reading landed by the generic vendor-agnostic
 * ingestion endpoint (functions/api/ingest/weather.ts -> D1's
 * weather_observations/latest_conditions), via
 * functions/api/public/weather-latest.ts. This is the ONLY weather
 * provider that reads D1 at all - 'atc' reads the separate KV
 * capture-ingest Worker directly, 'internet' calls Open-Meteo directly,
 * neither ever touches D1.
 */

// Generic third-party feeds could have a much slower cadence than PC2's
// 60s capture (atcProvider.ts's own threshold) - 30 minutes is a more
// reasonable generic staleness bound for "some other vendor's station or
// API," not tuned to any one integration's actual interval.
const STALE_THRESHOLD_MS = 30 * 60 * 1000

interface LatestIngestedResponse {
  observedAt: string
  windSpeedKt: number | null
  windDirDeg: number | null
  windGustKt: number | null
  qnhHpa: number | null
  tempC: number | null
  dewpointC: number | null
  notams: string[]
}

// Anything not cleanly a string[] (a source that never sends this field
// at all, or a malformed one) is treated as "no notams", matching
// atcProvider.ts's own leniency for the identical shape - a missing
// notams field isn't a reason to blank the whole reading.
function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

export const fetchIngestedWeather: WeatherProviderFetcher = async () => {
  const response = await fetch(INGESTED_WEATHER_LATEST_URL)
  if (response.status === 404) {
    throw new Error('No third-party weather data has been ingested yet')
  }
  if (!response.ok) {
    throw new Error(`Weather ingest endpoint responded with ${response.status}`)
  }

  const reading = (await response.json()) as LatestIngestedResponse | null
  if (!reading) {
    throw new Error('No usable ingested reading')
  }

  const observedAtMs = Date.parse(reading.observedAt)
  if (Number.isNaN(observedAtMs) || Date.now() - observedAtMs > STALE_THRESHOLD_MS) {
    throw new Error(`Latest ingested reading is stale (observed at ${reading.observedAt})`)
  }

  if (reading.windDirDeg === null || reading.windSpeedKt === null || reading.tempC === null || reading.qnhHpa === null) {
    throw new Error('Latest ingested reading is missing one or more required fields')
  }

  const data: WeatherData = {
    windSpeed: reading.windSpeedKt,
    windDirection: reading.windDirDeg,
    windGust: reading.windGustKt ?? undefined,
    temperature: reading.tempC,
    qnh: reading.qnhHpa,
    // Generic ingestion has no trend field to work from - same
    // limitation atcProvider.ts's own station has, not a regression.
    pressureTrend: 'steady',
    // Was hardcoded to [] - found during the ATC/PC2 multi-tenant
    // migration investigation that this silently dropped real NOTAMs
    // the moment a tenant with an actual NOTAMs-producing source (e.g.
    // Shobdon, post-migration) selected this provider. See migration
    // 0045's own comment for the full story.
    notams: stringArrayField(reading.notams),
    dewpoint: reading.dewpointC ?? undefined,
    capturedAt: reading.observedAt,
  }

  return { data, live: true }
}
