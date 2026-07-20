// Public, UNAUTHENTICATED server-side proxy to the Met Office Weather
// DataHub Site Specific Forecast API - GET /api/public/weather-metoffice.
// Host-resolved tenant, same pattern as weather-default.ts/config.ts.
//
// Proxied (not called directly from the browser) specifically because
// DataHub requires a secret API key (env.MET_OFFICE_DATAHUB_KEY, a
// Cloudflare Pages secret - never hardcoded, never sent to the client).
// This is the ATC-primary/internet-fallback auto-switch's fallback
// source (see src/context/WeatherContext.tsx) - NOT DataPoint, which was
// retired 1 Dec 2025.
//
// Endpoint/auth/response shape confirmed directly against the Met
// Office's own published OpenAPI spec (datahub.metoffice.gov.uk/
// downloads/api-definitions/weathercloud2api_subscriber.json) and
// cross-checked against a real, actively-maintained open-source client
// (github.com/Perseudonymous/datapoint-python's Manager.py, which is the
// current DataHub-era successor of the old "datapoint" package despite
// its legacy name) - not guessed. Base URL:
// https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/, auth via
// an `apikey` request header (not Bearer), GeoJSON response with
// features[0].properties.timeSeries[] holding one entry per forecast
// hour: windSpeed10m/windGustSpeed10m in m/s, windDirectionFrom10m in
// degrees, screenTemperature in °C, mslp in Pa.

import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  MET_OFFICE_DATAHUB_KEY?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const DATAHUB_HOURLY_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly";

// Shobdon Aerodrome - same coordinates weatherConfigStore.ts's own
// DEFAULT_WEATHER_CONFIG.internet uses as its built-in fallback. This
// endpoint prefers the requesting tenant's own tenants.lat/lon (same
// resolution weather-default.ts already does) and only falls back to
// this constant if that tenant has none on file - matching this
// codebase's established "still genuinely single-tenant, but don't
// hardcode where a real per-tenant value already exists" posture.
const SHOBDON_LATITUDE = 52.2416;
const SHOBDON_LONGITUDE = -2.8821;

interface TenantLocationRow {
  lat: number | null;
  lon: number | null;
}

interface DataHubTimeSeriesEntry {
  time: string;
  screenTemperature?: number;
  windSpeed10m?: number;
  windDirectionFrom10m?: number;
  windGustSpeed10m?: number;
  mslp?: number;
}

interface DataHubResponse {
  features?: {
    properties?: {
      timeSeries?: DataHubTimeSeriesEntry[];
    };
  }[];
}

const METRES_PER_SECOND_TO_KNOTS = 1.943844;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  if (!env.MET_OFFICE_DATAHUB_KEY) {
    return jsonResponse({ error: "MET_OFFICE_DATAHUB_KEY is not configured" }, 502);
  }

  const locationRow = await env.DB.prepare("SELECT lat, lon FROM tenants WHERE id = ?").bind(tenant.id).first<TenantLocationRow>();
  const latitude = locationRow?.lat ?? SHOBDON_LATITUDE;
  const longitude = locationRow?.lon ?? SHOBDON_LONGITUDE;

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    excludeParameterMetadata: "true",
    includeLocationName: "false",
  });

  let dataHubResponse: Response;
  try {
    dataHubResponse = await fetch(`${DATAHUB_HOURLY_URL}?${params.toString()}`, {
      headers: { accept: "application/json", apikey: env.MET_OFFICE_DATAHUB_KEY },
    });
  } catch (error) {
    return jsonResponse({ error: `Met Office DataHub request failed: ${error}` }, 502);
  }

  if (!dataHubResponse.ok) {
    return jsonResponse({ error: `Met Office DataHub responded with ${dataHubResponse.status}` }, 502);
  }

  const data = (await dataHubResponse.json().catch(() => null)) as DataHubResponse | null;
  const timeSeries = data?.features?.[0]?.properties?.timeSeries;
  // First entry is the nearest forecast hour to now - the Site Specific
  // Forecast API is forward-looking only (no historical entries), so
  // there is no earlier point to compare against for a genuine pressure
  // trend the way internetProviders/openMeteo.ts derives one from
  // Open-Meteo's past_hours data. pressureTrend is left 'steady' below
  // for that reason, not computed and guessed at.
  const current = timeSeries?.[0];
  if (!current) {
    return jsonResponse({ error: "Met Office DataHub response has no usable forecast entry" }, 502);
  }

  const {
    screenTemperature,
    windSpeed10m,
    windDirectionFrom10m,
    windGustSpeed10m,
    mslp,
  } = current;

  if (
    typeof windSpeed10m !== "number" ||
    typeof windDirectionFrom10m !== "number" ||
    typeof screenTemperature !== "number" ||
    typeof mslp !== "number"
  ) {
    return jsonResponse({ error: "Met Office DataHub forecast entry is missing required fields" }, 502);
  }

  return jsonResponse({
    windSpeed: Math.round(windSpeed10m * METRES_PER_SECOND_TO_KNOTS),
    windDirection: Math.round(windDirectionFrom10m),
    windGust: typeof windGustSpeed10m === "number" ? Math.round(windGustSpeed10m * METRES_PER_SECOND_TO_KNOTS) : undefined,
    temperature: Math.round(screenTemperature),
    qnh: Math.round(mslp / 100),
    pressureTrend: "steady",
    notams: [],
  });
};
