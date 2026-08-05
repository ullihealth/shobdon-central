import { WEATHER_STATION_URL, WEATHER_POLL_INTERVAL_MS } from '../config/weatherStation'
import { WEATHER_DEFAULT_URL } from '../config/publicApi'
import type { WeatherConfig } from '../types/weatherConfig'

const STORAGE_KEY = 'shobdon-central.weather-config.v1'

// Shobdon Aerodrome coordinates - kept as the final built-in fallback
// (used only if resolveWeatherConfig()'s server call itself fails, e.g.
// offline) and as the shape every other config gets merged onto below.
// This is NOT what a fresh device actually gets by default any more -
// see resolveWeatherConfig().
export const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  activeProvider: 'mock',
  atc: {
    stationUrl: WEATHER_STATION_URL,
    refreshIntervalSeconds: WEATHER_POLL_INTERVAL_MS / 1000,
    connectionTimeoutMs: 5000,
    autoReconnectEnabled: true,
  },
  internet: {
    provider: 'open-meteo',
    latitude: 52.2416,
    longitude: -2.8821,
    refreshIntervalSeconds: 30,
  },
}

// Synchronous, localStorage-only - unchanged behaviour, still used
// wherever an immediate (non-server-aware) value is needed. Returns
// DEFAULT_WEATHER_CONFIG (mock) if nothing is stored yet; callers that
// want a real per-tenant default for a brand-new device should use
// resolveWeatherConfig() below instead.
export function loadWeatherConfig(): WeatherConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WEATHER_CONFIG

    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_WEATHER_CONFIG,
      ...parsed,
      atc: { ...DEFAULT_WEATHER_CONFIG.atc, ...parsed.atc },
      internet: { ...DEFAULT_WEATHER_CONFIG.internet, ...parsed.internet },
    }
  } catch {
    return DEFAULT_WEATHER_CONFIG
  }
}

export function saveWeatherConfig(config: WeatherConfig): void {
  console.log('[DEBUG-ATC-PROBE] (3) about to write weather-config to localStorage', { key: STORAGE_KEY, activeProvider: config.activeProvider })
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

interface ServerWeatherDefault {
  activeProvider?: string
  internet?: { provider?: string; latitude?: number; longitude?: number; refreshIntervalSeconds?: number }
}

// Deliberately invalid - not a real place, just a value guaranteed to
// make internetProvider.ts's Open-Meteo request fail its own
// hasUsableCurrentReading() check (see that file's own comment on why a
// malformed/missing `current` object is treated as a failure, not a
// crash). Picked over reusing DEFAULT_WEATHER_CONFIG's own Shobdon
// coordinates specifically because a real-looking fallback location is
// the exact bug this file already fixed once (a fresh device on any
// OTHER tenant silently showing Shobdon's weather) - "unavailable" must
// never resolve to a plausible-looking place.
const UNAVAILABLE_COORDINATES = { latitude: NaN, longitude: NaN }

// Server-aware default resolution for a device that has never been
// configured (no localStorage entry yet) - e.g. a brand-new tenant's
// first-ever page load, or any fresh browser/kiosk. An ALREADY-
// configured device (existing localStorage entry - Shobdon's own
// kiosks/PC2 flow, or any device where someone has deliberately picked
// a source before) is completely untouched: this only ever changes what
// a BLANK device sees before its first deliberate choice, never
// overrides an existing one.
//
// Without this, a fresh device on any tenant OTHER than Shobdon
// defaulted to DEFAULT_WEATHER_CONFIG above - 'mock' data, and if
// switched to 'internet' would have silently shown SHOBDON's weather
// (its hardcoded coordinates), regardless of where that tenant actually
// is. functions/api/public/weather-default.ts resolves the real
// per-tenant default server-side instead, from that tenant's own
// tenants.lat/lon.
export async function resolveWeatherConfig(): Promise<WeatherConfig> {
  let hasStoredConfig = false
  try {
    hasStoredConfig = window.localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    hasStoredConfig = false
  }

  if (hasStoredConfig) return loadWeatherConfig()

  try {
    const response = await fetch(WEATHER_DEFAULT_URL)
    if (response.ok) {
      const serverDefault = (await response.json()) as ServerWeatherDefault | null
      if (serverDefault?.activeProvider === 'internet' && serverDefault.internet) {
        return {
          ...DEFAULT_WEATHER_CONFIG,
          activeProvider: 'internet',
          internet: { ...DEFAULT_WEATHER_CONFIG.internet, ...serverDefault.internet },
        }
      }
      // 'ingested' - this tenant has an active incoming weather share
      // (tenant_weather_shares) - see weather-default.ts's own comment
      // for why that's checked ahead of lat/lon and wins regardless. No
      // client-side settings for this provider at all (see
      // IngestedWeatherConfigSection.tsx's own comment) - what it reads
      // is resolved entirely server-side by weather-latest.ts.
      if (serverDefault?.activeProvider === 'ingested') {
        return { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'ingested' }
      }
      // 'atc' - this tenant has real physical ATC/PC2 hardware
      // (has_physical_atc, migration 0038) - see weather-default.ts's
      // own comment for why a brand-new device should try the real
      // station before ever falling back to a generic regional
      // forecast. No per-provider config to merge in either, same
      // "no client-side settings" shape as 'ingested' above -
      // DEFAULT_WEATHER_CONFIG.atc's own stationUrl/refreshInterval/
      // timeout/autoReconnect defaults are already exactly what a
      // fresh device should start with.
      if (serverDefault?.activeProvider === 'atc') {
        return { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'atc' }
      }
      // 'unavailable' - no share and no lat/lon on file for this tenant
      // (weather-default.ts's own comment). Deliberately NOT the same as
      // falling through to plain DEFAULT_WEATHER_CONFIG below - that
      // reads as a DELIBERATE 'mock' choice (WeatherContext.tsx's
      // liveDataUnavailable is false for it), silently showing
      // fabricated numbers as if they were live. 'internet' + guaranteed-
      // invalid coordinates instead trips the exact same "provider fetch
      // failed" path a real configured source's own outage already uses
      // everywhere on the dashboard (N/A readouts, "NO LIVE READING"
      // status) - the honest state for "no real weather source is set
      // up for this tenant," not a demo/dev choice.
      if (serverDefault?.activeProvider === 'unavailable') {
        return {
          ...DEFAULT_WEATHER_CONFIG,
          activeProvider: 'internet',
          internet: { ...DEFAULT_WEATHER_CONFIG.internet, ...UNAVAILABLE_COORDINATES },
        }
      }
    }
  } catch {
    // Network/endpoint failure - fall through to the safe local default
    // below rather than leaving the caller with nothing.
  }

  return DEFAULT_WEATHER_CONFIG
}
