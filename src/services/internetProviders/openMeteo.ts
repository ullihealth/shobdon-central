import type { WeatherProviderFetcher } from '../weatherProviders/types'
import type { PressureTrend, WeatherData } from '../../types/weather'

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast'
const PRESSURE_TREND_THRESHOLD_HPA = 0.5

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

export const fetchOpenMeteoWeather: WeatherProviderFetcher = async (config) => {
  const { latitude, longitude } = config.internet
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

  const response = await fetch(`${OPEN_METEO_BASE_URL}?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Open-Meteo responded with ${response.status}`)
  }

  const json = (await response.json()) as OpenMeteoResponse
  const data: WeatherData = {
    windSpeed: Math.round(json.current.wind_speed_10m),
    windDirection: Math.round(json.current.wind_direction_10m),
    windGust: Math.round(json.current.wind_gusts_10m),
    temperature: Math.round(json.current.temperature_2m),
    qnh: Math.round(json.current.pressure_msl),
    pressureTrend: derivePressureTrend(json),
  }

  return { data, live: true }
}
