import type { WeatherProviderFetcher } from '../weatherProviders/types'
import type { PressureTrend, WeatherData } from '../../types/weather'

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast'
const PRESSURE_TREND_THRESHOLD_HPA = 0.5

// UK Met Office's own high-resolution (2km) model, re-served through
// Open-Meteo's API - confirmed live (2026-07) this is a real, working
// `models` value there, distinct from Open-Meteo's default "auto" blend
// across whatever models it has for a location. Requested first so a UK
// tenant's current-conditions numbers come from the Met Office's own
// model rather than an arbitrary blend, since that's the source a UK
// pilot is most likely to compare this against. Falls back to the
// default blend (no `models` param) for any tenant outside this model's
// coverage area - confirmed live that an out-of-coverage request
// doesn't error, it returns HTTP 200 with nan latitude/longitude and no
// `current` object at all, so the fallback below checks the RESPONSE
// SHAPE, not response.ok/HTTP status.
const PREFERRED_MODEL = 'ukmo_uk_deterministic_2km'

interface OpenMeteoResponse {
  current: {
    time: string
    temperature_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    wind_gusts_10m: number
    pressure_msl: number
  }
  hourly: {
    time: string[]
    pressure_msl: number[]
  }
}

// Derives rising/falling/steady by comparing mean-sea-level pressure for the
// current hour against the previous hour (Open-Meteo has no trend field).
function derivePressureTrend(response: OpenMeteoResponse): PressureTrend {
  const currentHour = response.current.time.slice(0, 13) // "YYYY-MM-DDTHH"
  const index = response.hourly.time.findIndex((time) => time.startsWith(currentHour))
  if (index <= 0) return 'steady'

  const delta = response.hourly.pressure_msl[index] - response.hourly.pressure_msl[index - 1]
  if (delta > PRESSURE_TREND_THRESHOLD_HPA) return 'rising'
  if (delta < -PRESSURE_TREND_THRESHOLD_HPA) return 'falling'
  return 'steady'
}

async function fetchOpenMeteoOnce(latitude: number, longitude: number, models?: string): Promise<OpenMeteoResponse | null> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl',
    hourly: 'pressure_msl',
    past_hours: '3',
    forecast_days: '1',
    wind_speed_unit: 'kn',
    timezone: 'auto',
  })
  if (models) params.set('models', models)

  const response = await fetch(`${OPEN_METEO_BASE_URL}?${params.toString()}`)
  if (!response.ok) return null
  return (await response.json().catch(() => null)) as OpenMeteoResponse | null
}

// Guards against exactly the "200 OK, but no usable data" shape a
// coverage-area miss returns (see PREFERRED_MODEL's own comment) - a
// malformed/incomplete `current` object is treated the same as an
// outright request failure, both fall through to the plain-blend retry.
function hasUsableCurrentReading(json: OpenMeteoResponse | null): json is OpenMeteoResponse {
  const current = json?.current
  return (
    !!current &&
    typeof current.temperature_2m === 'number' &&
    typeof current.wind_speed_10m === 'number' &&
    typeof current.wind_direction_10m === 'number' &&
    typeof current.wind_gusts_10m === 'number' &&
    typeof current.pressure_msl === 'number'
  )
}

export const fetchOpenMeteoWeather: WeatherProviderFetcher = async (config) => {
  const { latitude, longitude } = config.internet

  let json = await fetchOpenMeteoOnce(latitude, longitude, PREFERRED_MODEL).catch(() => null)
  if (!hasUsableCurrentReading(json)) {
    json = await fetchOpenMeteoOnce(latitude, longitude).catch(() => null)
  }
  if (!hasUsableCurrentReading(json)) {
    throw new Error('Open-Meteo returned no usable current reading (preferred model and default blend both failed)')
  }

  const data: WeatherData = {
    windSpeed: Math.round(json.current.wind_speed_10m),
    windDirection: Math.round(json.current.wind_direction_10m),
    windGust: Math.round(json.current.wind_gusts_10m),
    temperature: Math.round(json.current.temperature_2m),
    qnh: Math.round(json.current.pressure_msl),
    pressureTrend: derivePressureTrend(json),
    notams: [], // Open-Meteo has no NOTAM concept
  }

  return { data, live: true }
}
