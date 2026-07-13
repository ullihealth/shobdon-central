// Public, UNAUTHENTICATED read endpoint for the live kiosk dashboard.
// GET /api/public/:tenant/visibility-forecast -> Met Office hourly-ahead
// visibility forecast, categorised.
//
// Deliberately its OWN route, separate from config.ts, even though both
// serve the same public dashboard - a bug or outage in this Met Office
// integration must never be able to take down runwayGroups/theme/
// cameraSlots/carouselSlots/opsPanel, which all share config.ts's single
// response. Isolating this here means the worst a failure here can do is
// leave this one card showing "unavailable".
//
// Shobdon's own station has no visibility sensor - this is net-new
// forecast data, not a replacement for a measured reading, and the client
// label ("Visibility Outlook (Met Office Forecast)") says so explicitly.

type KVNamespace = {
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

type PagesFunction<Env = unknown> = (context: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) => Response | Promise<Response>;

interface Env {
  DB: D1Database;
  WEATHER_CACHE: KVNamespace;
  MET_OFFICE_API_KEY?: string;
}

// Shobdon Aerodrome coordinates - matches DEFAULT_WEATHER_CONFIG.internet
// in src/services/weatherConfigStore.ts. Hardcoded rather than read from
// D1: this app is single-tenant today and there's no admin UI for
// per-tenant coordinates yet - move into D1 (alongside runway_groups) if
// a second tenant ever needs this route with its own location, not before.
const SHOBDON_LATITUDE = 52.2416;
const SHOBDON_LONGITUDE = -2.8821;

const MET_OFFICE_BASE_URL = "https://data.hub.api.metoffice.gov.uk/sitespecific/v0/point/hourly";

// Matches the approved plan's refresh interval: the upstream hourly
// forecast itself only changes roughly once an hour, and this keeps Met
// Office calls to ~24/day, well under the 360/day free-tier allowance.
// This TTL is also what enforces "never silently serve stale data" - once
// a KV entry expires it simply no longer exists, so the next request must
// either refetch successfully or report unavailable; there is no manual
// staleness timestamp to check or forget to check.
const CACHE_TTL_SECONDS = 60 * 60;

interface CachedForecast {
  forecastForUtc: string;
  visibilityM: number;
  category: string;
  rangeLabel: string;
  fetchedAt: string;
}

type VisibilityForecastResponse = ({ available: true } & CachedForecast) | { available: false };

function jsonResponse(body: unknown, status = 200): Response {
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
}

interface MetOfficeResponse {
  features: {
    properties: {
      timeSeries: MetOfficeTimeStep[];
    };
  }[];
}

// "Hourly-ahead" - the first forecast step strictly after now, not the
// current/nearest hour. Picks the earliest such step rather than assuming
// a fixed array index, since the API's first returned step is sometimes
// the current hour and sometimes already the next one.
function pickHourAhead(steps: MetOfficeTimeStep[]): MetOfficeTimeStep | null {
  const nowMs = Date.now();
  const future = steps
    .filter((step) => typeof step.visibility === "number" && Date.parse(step.time) > nowMs)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  return future[0] ?? null;
}

async function fetchFromMetOffice(apiKey: string): Promise<CachedForecast | null> {
  const url = new URL(MET_OFFICE_BASE_URL);
  url.searchParams.set("latitude", String(SHOBDON_LATITUDE));
  url.searchParams.set("longitude", String(SHOBDON_LONGITUDE));
  url.searchParams.set("excludeParameterMetadata", "true");
  url.searchParams.set("includeLocationName", "false");

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json", apikey: apiKey },
  });
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as MetOfficeResponse | null;
  const steps = body?.features?.[0]?.properties?.timeSeries;
  if (!Array.isArray(steps)) return null;

  const step = pickHourAhead(steps);
  if (!step || typeof step.visibility !== "number") return null;

  const { category, rangeLabel } = categorise(step.visibility);
  return {
    forecastForUtc: step.time,
    visibilityM: step.visibility,
    category,
    rangeLabel,
    fetchedAt: new Date().toISOString(),
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const slug = params.tenant;
  if (!slug) return jsonResponse({ error: "Missing tenant" }, 400);

  const org = await env.DB.prepare("SELECT id FROM organization WHERE slug = ?").bind(slug).first<{ id: string }>();
  if (!org) return jsonResponse({ error: "Unknown tenant" }, 404);

  const cacheKey = `visibility-forecast:${org.id}`;

  const cached = await env.WEATHER_CACHE.get<CachedForecast>(cacheKey, "json");
  if (cached) {
    const response: VisibilityForecastResponse = { available: true, ...cached };
    return jsonResponse(response);
  }

  if (!env.MET_OFFICE_API_KEY) {
    // Not configured yet - a deliberate "unavailable", not a 500, so the
    // client's degrade path is exercised the same way as any other
    // upstream failure rather than needing a special case for this one.
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  const fresh = await fetchFromMetOffice(env.MET_OFFICE_API_KEY).catch(() => null);
  if (!fresh) {
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  await env.WEATHER_CACHE.put(cacheKey, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });

  const response: VisibilityForecastResponse = { available: true, ...fresh };
  return jsonResponse(response);
};
