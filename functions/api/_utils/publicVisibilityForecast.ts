// Shared response-building logic for the public, UNAUTHENTICATED Met
// Office visibility forecast read. Extracted from functions/api/public/
// [tenant]/visibility-forecast.ts (the original slug-based route) so
// functions/api/public/visibility-forecast.ts (the new host-based route,
// Stage 3) can share the exact same fetch/cache/response logic instead
// of a second copy to keep in sync. Both routes just resolve
// organizationId differently (URL path segment vs. Host header) and
// hand it to this.
//
// Deliberately its own route/response, separate from publicConfig.ts,
// even though both serve the same public dashboard - a bug or outage in
// this Met Office integration must never be able to take down
// runwayGroups/theme/cameraSlots/carouselSlots/opsPanel, which all share
// publicConfig.ts's single response. Isolating this here means the worst
// a failure here can do is leave this one card showing "unavailable".

export type KVNamespace = {
  get: <T = unknown>(key: string, type: "json") => Promise<T | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

export interface PublicVisibilityForecastEnv {
  WEATHER_CACHE: KVNamespace;
  MET_OFFICE_API_KEY?: string;
  DB: D1Database;
}

const MET_OFFICE_BASE_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly";

// Matches the approved plan's refresh interval: the upstream hourly
// forecast itself only changes roughly once an hour, and this keeps Met
// Office calls to ~24/day, well under the 360/day free-tier allowance.
// This TTL is also what enforces "never silently serve stale data" - once
// a KV entry expires it simply no longer exists, so the next request must
// either refetch successfully or report unavailable; there is no manual
// staleness timestamp to check or forget to check.
const CACHE_TTL_SECONDS = 60 * 60;

interface VisibilityHour {
  forecastForUtc: string;
  visibilityM: number;
  category: string;
  rangeLabel: string;
  // Met Office's own 0-30 "Significant Weather Code" - same timeSeries
  // entry as visibility, no second API call. Optional: unlike visibility
  // (which gates whether an hour is included at all), a missing code for
  // an otherwise-valid hour shouldn't drop that hour's visibility data -
  // the client just has nothing to show for that hour's weather-type icon.
  weatherCode?: number;
}

interface CachedForecast {
  // Ordered nearest-hour first. The existing single-value "Visibility
  // Outlook" card reads hours[0] - same value it always showed, just
  // sourced from this array now instead of a lone field. The
  // Cloud/Visibility Chart's trend strip uses the rest.
  hours: VisibilityHour[];
  fetchedAt: string;
}

type VisibilityForecastResponse = ({ available: true } & CachedForecast) | { available: false };

// "Several upcoming hours" per the approved plan - long enough for a
// genuine trend strip, short enough to stay a tight glance. Not a hard
// requirement: fetchFromMetOffice returns however many valid steps it
// actually finds, up to this count.
const FORECAST_HOUR_COUNT = 6;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Contiguous, non-overlapping 100m-resolution bands matching standard
// aviation visibility reporting (visibility reported in 100m steps below
// 5km). Computed here from the raw metre value rather than trusting any
// pre-labelled string the API might also provide - keeps the category
// definition under this app's own control and testable.
function categorise(visibilityM: number): { category: string; rangeLabel: string } {
  if (visibilityM <= 1000) return { category: "Very Poor", rangeLabel: "<1km" };
  if (visibilityM <= 4000) return { category: "Poor", rangeLabel: "1.1km-4km" };
  if (visibilityM <= 10000) return { category: "Moderate", rangeLabel: "4.1km-10km" };
  if (visibilityM <= 20000) return { category: "Good", rangeLabel: "10.1km-20km" };
  if (visibilityM <= 40000) return { category: "Very Good", rangeLabel: "20.1km-40km" };
  return { category: "Excellent", rangeLabel: ">40km" };
}

interface MetOfficeTimeStep {
  time: string;
  visibility?: number;
  significantWeatherCode?: number;
}

interface MetOfficeResponse {
  features: {
    properties: {
      timeSeries: MetOfficeTimeStep[];
    };
  }[];
}

// "Hourly-ahead" - forecast steps strictly after now, not the
// current/nearest hour. Picks the earliest such steps rather than assuming
// a fixed array index, since the API's first returned step is sometimes
// the current hour and sometimes already the next one.
function pickUpcomingHours(steps: MetOfficeTimeStep[], count: number): MetOfficeTimeStep[] {
  const nowMs = Date.now();
  return steps
    .filter((step) => typeof step.visibility === "number" && Date.parse(step.time) > nowMs)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .slice(0, count);
}

async function fetchFromMetOffice(apiKey: string, latitude: number, longitude: number): Promise<CachedForecast | null> {
  const url = new URL(MET_OFFICE_BASE_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("excludeParameterMetadata", "true");
  url.searchParams.set("includeLocationName", "false");

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json", apikey: apiKey },
  });
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as MetOfficeResponse | null;
  const steps = body?.features?.[0]?.properties?.timeSeries;
  if (!Array.isArray(steps)) return null;

  const upcoming = pickUpcomingHours(steps, FORECAST_HOUR_COUNT);
  if (upcoming.length === 0) return null;

  const hours: VisibilityHour[] = upcoming.map((step) => {
    // typeof step.visibility === "number" already guaranteed by the
    // filter inside pickUpcomingHours.
    const { category, rangeLabel } = categorise(step.visibility as number);
    const weatherCode = typeof step.significantWeatherCode === "number" ? step.significantWeatherCode : undefined;
    return { forecastForUtc: step.time, visibilityM: step.visibility as number, category, rangeLabel, weatherCode };
  });

  return { hours, fetchedAt: new Date().toISOString() };
}

export async function buildVisibilityForecastResponse(
  organizationId: string,
  env: PublicVisibilityForecastEnv
): Promise<Response> {
  const cacheKey = `visibility-forecast:${organizationId}`;

  // Array.isArray check, not just truthiness - a cache entry written by
  // the previous single-value version of this route (hours field didn't
  // exist yet) is still a valid, non-null KV read, but has no .hours at
  // all. Treating that as a hit would hand the client `hours: undefined`
  // and crash it. Anything not matching the current shape is treated as
  // a miss, same as no cache entry existing yet - the TTL will naturally
  // replace it with a well-formed entry on the next successful fetch.
  const cached = await env.WEATHER_CACHE.get<CachedForecast>(cacheKey, "json");
  if (cached && Array.isArray(cached.hours)) {
    const response: VisibilityForecastResponse = { available: true, ...cached };
    return jsonResponse(response);
  }

  if (!env.MET_OFFICE_API_KEY) {
    // Not configured yet - a deliberate "unavailable", not a 500, so the
    // client's degrade path is exercised the same way as any other
    // upstream failure rather than needing a special case for this one.
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  // Each tenant's own coordinates (tenants.lat/lon), same source
  // weather-default.ts already reads - this used to be a hardcoded
  // Shobdon-only constant here (found during the pre-onboarding
  // isolation/branding audit: every tenant's forecast card was silently
  // showing SHOBDON's Met Office forecast, not their own). No
  // coordinates on file -> unavailable, same "nothing sensible to
  // default to" stance weather-default.ts takes, never a wrong location.
  const tenantLocation = await env.DB
    .prepare("SELECT lat, lon FROM tenants WHERE organization_id = ?")
    .bind(organizationId)
    .first<{ lat: number | null; lon: number | null }>();
  if (!tenantLocation || tenantLocation.lat === null || tenantLocation.lon === null) {
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  const fresh = await fetchFromMetOffice(env.MET_OFFICE_API_KEY, tenantLocation.lat, tenantLocation.lon).catch(() => null);
  if (!fresh) {
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  await env.WEATHER_CACHE.put(cacheKey, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });

  const response: VisibilityForecastResponse = { available: true, ...fresh };
  return jsonResponse(response);
}
