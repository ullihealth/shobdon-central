export type PressureTrend = 'rising' | 'falling' | 'steady'

export interface WeatherData {
  windSpeed: number // knots
  windDirection: number // degrees, 0-360
  windGust?: number // knots
  temperature: number // Celsius
  qnh: number // hPa
  // Only ever populated by the 'atc' provider (Shobdon's own Vantage
  // Pro2 station reports it as its own distinct field, not derived) -
  // undefined for mock/internet/ingested, same scope as dewpoint below.
  // Powers the Weather Summary QFE card; a missing value means that
  // card shows N/A rather than presenting QNH twice.
  qfe?: number // hPa
  pressureTrend: PressureTrend
  notams: string[] // active NOTAM text(s); empty array means genuinely none, not "unknown"
  // Only ever populated by the 'atc' provider (Shobdon's own Vantage Pro2
  // station) - undefined for mock/internet, which have no dewpoint source.
  // Powers the Cloud Base (Shobdon Calculated) card; a missing value means
  // that card shows N/A rather than a fabricated estimate.
  dewpoint?: number // Celsius
  // ISO timestamp of when the station reading this data came from was
  // actually captured (Vantage Pro2 -> capture-weathercentral.ps1, ~60s
  // cadence) - only ever set by the 'atc' provider, same as dewpoint.
  // Powers the Cloud Base Forecast card's "Last updated" line with a
  // genuine freshness value, not the current render time.
  capturedAt?: string
  // Only ever populated by the 'ingested' provider, and only when the
  // reading came via an active cross-tenant weather share
  // (tenant_weather_shares) - the SOURCE tenant's own display name (e.g.
  // "Shobdon Airfield"), so WeatherStatusIndicator.tsx can name the
  // actual source in its badge instead of a generic "Third-Party
  // Station" label. undefined for every other provider, and for
  // 'ingested' with no active share (a tenant's own genuine third-party
  // feed).
  sourceTenantName?: string
  // The underlying reading's own source_type column (functions/api/
  // ingest/weather.ts's ALLOWED_SOURCE_TYPES) - same "only ever
  // populated by 'ingested'" scope as sourceTenantName above. Lets the
  // badge tell a genuinely ATC-captured shared reading apart from a
  // shared tenant's own internet/third-party feed and style/label
  // accordingly - must never claim "ATC" for data that didn't actually
  // come from a physical station.
  //
  // 'met_office_fallback' (platform weather-fallback cron round) -
  // distinct from 'internet' deliberately: 'internet' means a tenant's
  // own GENUINE primary source is an internet-based API; this means the
  // station-owning parent tenant's real 'atc' feed went stale and the
  // platform-level cron job (worker/src/index.ts's scheduled handler)
  // substituted a Met Office/SAWS reading into weather_observations on
  // its behalf, auditable/distinguishable from a real capture by this
  // tag alone. WeatherStatusIndicator.tsx gives this the SAME blue
  // "Met-Office SAWS" treatment activeProvider 'atc''s own client-side
  // fallback already shows on the source tenant's own dashboard - a
  // subtenant should see the identical story its parent would.
  sourceReadingType?: 'atc_capture' | 'internet' | 'third_party_api' | 'met_office_fallback'
}

// 'mock' means the station could not be reached or its response could not
// yet be parsed; the UI should treat 'live' as the only trustworthy source.
export type WeatherSource = 'live' | 'mock'
