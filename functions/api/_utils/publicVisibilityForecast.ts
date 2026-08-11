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

import { resolveEffectiveTenantByOrganizationId } from "./resolveParentTenant";
import { isDaytimeAt } from "./solarPosition";

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
  // Computed here (solarPosition.ts), not read from Met Office - several
  // significant weather codes (7 Cloudy, 8 Overcast) have no night variant
  // in Met Office's own scheme at all, so the client can't get day/night
  // for those from weatherCode no matter what. Always present whenever
  // weatherCode is (never optional) - unlike weatherCode, this never
  // depends on what Met Office chose to return; it only needs this step's
  // own timestamp and the tenant's already-resolved coordinates, both
  // guaranteed available by the time fetchFromMetOffice runs.
  isDaytime: boolean;
}

interface CachedForecast {
  // Ordered nearest-hour first. The existing single-value "Visibility
  // Outlook" card reads hours[0] - same value it always showed, just
  // sourced from this array now instead of a lone field. The
  // Cloud/Visibility Chart's trend strip uses the rest.
  hours: VisibilityHour[];
  fetchedAt: string;
  // Cached alongside hours (not re-queried from D1 on every request) so
  // withLiveNowIsDaytime below can run on a cache HIT with zero added DB
  // cost - a tenant's physical airfield location doesn't change within
  // this cache's own 60-minute TTL, so caching it here for that long is
  // harmless. See withLiveNowIsDaytime's own comment for why this is
  // needed at all.
  latitude: number;
  longitude: number;
}

type VisibilityForecastResponse = ({ available: true } & CachedForecast) | { available: false };

// "Several upcoming hours" per the approved plan - long enough for a
// genuine trend strip, short enough to stay a tight glance. Not a hard
// requirement: fetchFromMetOffice returns however many valid steps it
// actually finds, up to this count.
//
// 7, not 6 - one deliberate buffer hour. The client (CloudVisibilityChart's
// anchorIndexFor) re-anchors this array against the real clock on every
// render, since this cache can legitimately still be serving an entry up
// to 59 minutes after it stopped being "current" (this TTL, see
// CACHE_TTL_SECONDS below) - when that happens, the client correctly
// drops that one superseded entry rather than mislabelling it. Fetching
// only 6 meant that drop left just 5 real steps to show ("Now" through
// "+4h") for a real stretch of every hour, not 6 - confirmed live, not
// guessed. Since entries are hourly-spaced and the cache's own 60-minute
// TTL forces a refetch before a second entry could ever go stale in the
// same way, the client can only ever drop at most one - one extra
// fetched hour is sufficient headroom, not an arbitrary padding number.
const FORECAST_HOUR_COUNT = 7;

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
    const isDaytime = isDaytimeAt(Date.parse(step.time), latitude, longitude);
    return { forecastForUtc: step.time, visibilityM: step.visibility as number, category, rangeLabel, weatherCode, isDaytime };
  });

  return { hours, fetchedAt: new Date().toISOString(), latitude, longitude };
}

// Each hour's own isDaytime (above) is computed at THAT HOUR's own
// nominal start-timestamp - correct for what that hour represents, but
// the entry the CLIENT actually labels "Now" (CloudVisibilityChart.tsx's
// own anchorIndexFor) can be up to ~30 minutes in the future relative to
// the real current instant, by design (documented at length in that
// function's own comment, and deliberately not being touched here - it's
// shared with weatherCode/visibility/temperature-equivalent labelling
// that's already been fixed twice for unrelated stability reasons).
// Every day this is harmless slop. On the specific evening/morning where
// real sunset/sunrise falls inside that same lookahead window, it isn't:
// the anchored entry's OWN hour can already be past sunset even though
// the real current moment isn't yet - confirmed live on 2026-08-11 (true
// sunset ~20:41 BST, "Now" anchored to the 21:00 BST entry, correctly
// night for ITS hour, but showing before the real 20:41 sunset had
// happened). Rather than touch anchorIndexFor's shared selection logic,
// this only overwrites index 0's isDaytime with one computed fresh
// against Date.now() on every request (cache hit or miss) - the one slot
// actually presented to the user as "right now", where using the literal
// current instant is unambiguously correct. Every other hour (+1h
// onward) is a genuine future prediction, where "at that hour's own
// start" remains the right anchor - intentionally untouched.
function withLiveNowIsDaytime(forecast: CachedForecast): CachedForecast {
  if (forecast.hours.length === 0) return forecast;
  const liveHours = [...forecast.hours];
  liveHours[0] = { ...liveHours[0], isDaytime: isDaytimeAt(Date.now(), forecast.latitude, forecast.longitude) };
  return { ...forecast, hours: liveHours };
}

export async function buildVisibilityForecastResponse(
  organizationId: string,
  env: PublicVisibilityForecastEnv
): Promise<Response> {
  // Parent/sub-tenant round: resolved via tenants.parent_tenant_id
  // (migration 0059) rather than each tenant independently reading its
  // own lat/lon - a sub-tenant linked to a parent airfield should show
  // the SAME forecast product the parent shows, not just coincidentally
  // similar numbers from its own separately-fetched coordinates.
  const effective = await resolveEffectiveTenantByOrganizationId(env.DB, organizationId);

  // Keyed by the EFFECTIVE tenant's own organizationId - co-located
  // tenants linked to the same parent now share one cache entry (and
  // one upstream Met Office call) for what's physically the same
  // forecast, rather than each fetching and caching an identical result
  // under its own key.
  const cacheKey = `visibility-forecast:${effective.organizationId}`;

  // Array.isArray check, not just truthiness - a cache entry written by
  // the previous single-value version of this route (hours field didn't
  // exist yet) is still a valid, non-null KV read, but has no .hours at
  // all. Treating that as a hit would hand the client `hours: undefined`
  // and crash it. Anything not matching the current shape is treated as
  // a miss, same as no cache entry existing yet - the TTL will naturally
  // replace it with a well-formed entry on the next successful fetch.
  // Same posture extended to latitude/longitude (added alongside
  // withLiveNowIsDaytime) - an entry cached by the previous version of
  // this file has hours but no coordinates; treating that as a hit would
  // make withLiveNowIsDaytime compute isDaytime at (0, 0). Falls through
  // to a fresh fetch instead, which self-heals the cache with the
  // complete shape going forward.
  const cached = await env.WEATHER_CACHE.get<CachedForecast>(cacheKey, "json");
  if (cached && Array.isArray(cached.hours) && typeof cached.latitude === "number" && typeof cached.longitude === "number") {
    const response: VisibilityForecastResponse = { available: true, ...withLiveNowIsDaytime(cached) };
    return jsonResponse(response);
  }

  if (!env.MET_OFFICE_API_KEY) {
    // Not configured yet - a deliberate "unavailable", not a 500, so the
    // client's degrade path is exercised the same way as any other
    // upstream failure rather than needing a special case for this one.
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  // The EFFECTIVE tenant's own coordinates (tenants.lat/lon) - its
  // parent's, if linked; its own otherwise, same source weather-
  // default.ts already reads via the same resolver. This used to be a
  // hardcoded Shobdon-only constant here (found during the pre-
  // onboarding isolation/branding audit: every tenant's forecast card
  // was silently showing SHOBDON's Met Office forecast, not their own).
  // No coordinates on file -> unavailable, same "nothing sensible to
  // default to" stance weather-default.ts takes, never a wrong location.
  const tenantLocation = await env.DB
    .prepare("SELECT lat, lon FROM tenants WHERE organization_id = ?")
    .bind(effective.organizationId)
    .first<{ lat: number | null; lon: number | null }>();
  if (!tenantLocation || tenantLocation.lat === null || tenantLocation.lon === null) {
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  const fresh = await fetchFromMetOffice(env.MET_OFFICE_API_KEY, tenantLocation.lat, tenantLocation.lon).catch(() => null);
  if (!fresh) {
    return jsonResponse({ available: false } satisfies VisibilityForecastResponse);
  }

  // Cached WITHOUT the live "Now" correction - what's stored must reflect
  // each hour's own real forecast, not a snapshot of "now" at write time
  // that would otherwise sit frozen in KV for up to an hour.
  await env.WEATHER_CACHE.put(cacheKey, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });

  const response: VisibilityForecastResponse = { available: true, ...withLiveNowIsDaytime(fresh) };
  return jsonResponse(response);
}
