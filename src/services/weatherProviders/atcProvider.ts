import type { WeatherProviderFetcher } from './types'
import type { WeatherData } from '../../types/weather'
import { LATEST_READING_URL } from '../../config/captureEndpoint'

/**
 * The station's `adisp.php` page is on PC2's local LAN (192.168.2.1) and
 * can never be reached directly from an arbitrary browser running this
 * dashboard - same Mixed Content / cross-network constraint this whole
 * capture pipeline was built around. capture-weathercentral.ps1 runs on
 * PC2 itself, fetches the station directly, and posts the parsed reading
 * to the Worker/KV; this provider reads that already-parsed result back
 * out via a small JSON endpoint instead of attempting its own fetch of
 * the station.
 */

// Capture cadence is 60s (capture-weathercentral.ps1's $IntervalSeconds).
// Allow a few missed cycles of grace before treating a reading as too old
// to trust, rather than failing on every single delayed capture.
const STALE_THRESHOLD_MS = 3 * 60 * 1000

interface LatestReadingResponse {
  receivedAt: string
  capturedAt: string | null
  parsed: Record<string, unknown>
}

function numberField(parsed: Record<string, unknown>, key: string): number | null {
  const value = parsed[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// Unlike wind/temp/QNH, a missing or malformed notams field isn't a reason
// to throw and blank the whole reading - it's normal for this to be an
// empty array most of the time. Anything not cleanly a string[] falls back
// to empty rather than surfacing garbage.
function stringArrayField(parsed: Record<string, unknown>, key: string): string[] {
  const value = parsed[key]
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

export const fetchAtcWeather: WeatherProviderFetcher = async () => {
  const response = await fetch(LATEST_READING_URL)
  if (response.status === 404) {
    throw new Error('No ATC capture has been received yet')
  }
  if (!response.ok) {
    throw new Error(`Capture log responded with ${response.status}`)
  }

  const reading = (await response.json()) as LatestReadingResponse | null
  if (!reading || !reading.parsed) {
    throw new Error('Capture log has no usable reading')
  }

  // Deliberately keyed on the capture's own capturedAt (set by the script
  // at fetch time on PC2), not the station HTML's own observed_at_utc -
  // the station's Time field is multi-line/whitespace-heavy in a way the
  // Worker's parser doesn't yet handle, so observed_at_utc is unreliable
  // (frequently null) even on captures with otherwise perfectly-parsed
  // wind/temp/QNH. capturedAt has no such dependency - it's always set.
  if (!reading.capturedAt) {
    throw new Error('Latest capture has no capturedAt timestamp')
  }
  const capturedAtMs = Date.parse(reading.capturedAt)
  if (Number.isNaN(capturedAtMs) || Date.now() - capturedAtMs > STALE_THRESHOLD_MS) {
    throw new Error(`Latest capture is stale (captured at ${reading.capturedAt})`)
  }

  const windDirection = numberField(reading.parsed, 'wind_dir_deg')
  const windSpeed = numberField(reading.parsed, 'wind_speed_kt')
  const temperature = numberField(reading.parsed, 'temp_c')
  const qnh = numberField(reading.parsed, 'qnh_hpa')

  if (windDirection === null || windSpeed === null || temperature === null || qnh === null) {
    throw new Error('Latest capture is missing one or more required fields (wind direction/speed, temp, QNH)')
  }

  // Deliberately not in the required-field check above - dewpoint feeds
  // only the supplementary Cloud Base card, not the core reading, so a
  // capture that's missing it (station hiccup, format change) shouldn't
  // fail the whole weather fetch. numberField() already returns null for
  // anything missing/malformed; that null just becomes undefined here.
  const dewpoint = numberField(reading.parsed, 'dewpoint_c') ?? undefined

  const notams = stringArrayField(reading.parsed, 'notams')

  // wind_avg_kt is an averaging-period mean, not a gust reading - the
  // station doesn't expose a distinct gust field, so windGust is left
  // unset rather than mislabeling the average as a gust.
  const data: WeatherData = {
    windSpeed,
    windDirection,
    temperature,
    qnh,
    pressureTrend: 'steady',
    notams,
    dewpoint,
    capturedAt: reading.capturedAt,
  }

  return { data, live: true }
}
