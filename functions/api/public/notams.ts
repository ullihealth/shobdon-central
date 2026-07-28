// Public, UNAUTHENTICATED automated NOTAM feed - GET /api/public/notams.
// Host-resolved tenant, same pattern as weather-metoffice.ts/
// weather-default.ts. Consumed by RightInfoPanel.tsx's "Runway In Use"
// state, gated client-side on the same ops_panel_state.showAutoNotams
// flag /atc-control's "Automated NOTAM Feed" toggle already controls.
//
// No real provider credentials exist yet (FAA_NOTAM_CLIENT_ID/
// FAA_NOTAM_CLIENT_SECRET are unset in every environment as of this
// writing) - this is deliberate. The endpoint always degrades to
// { notams: [], providerConfigured: false } rather than erroring when no
// provider is configured, so this ships safely today and starts
// returning real data the moment credentials are added later, with no
// further code changes.
//
// FAA NOTAM API coverage caveat (UNVERIFIED - flagged, not resolved):
// this is the only provider wired up so far. It's documented as covering
// the US National Airspace System; UK ICAO codes (e.g. Shobdon's EGBS)
// are NOT documented as covered, and this has never been tested live
// against a real response (no credentials available to this round of
// work). parseFaaResponse() below is written defensively against FAA's
// publicly documented response shape, but has not been verified against
// a real payload - check/adjust it once real credentials exist. A second,
// UK-capable provider can be added as a sibling to createFaaProvider()
// without touching anything below getProvider().

import { resolveTenantFromHost, type D1Database } from "../_utils/resolveTenantHost";

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

// Same minimal structural KV type as publicVisibilityForecast.ts, plus a
// second get() overload (no type arg = raw text) for the fresh-sentinel
// presence check below, which has no JSON payload of its own.
type KVNamespace = {
  get: {
    <T = unknown>(key: string, type: "json"): Promise<T | null>;
    (key: string): Promise<string | null>;
  };
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

interface Env {
  DB: D1Database;
  WEATHER_CACHE: KVNamespace;
  FAA_NOTAM_CLIENT_ID?: string;
  FAA_NOTAM_CLIENT_SECRET?: string;
  // Generic second-provider slot (e.g. Laminar Data Hub) - unset today,
  // see createGenericProvider() below. Wiring a real second provider is a
  // separate, deliberate decision, not part of this round.
  NOTAM_PROVIDER_BASE_URL?: string;
  NOTAM_PROVIDER_API_KEY?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Same fallback coordinates weather-metoffice.ts/weather-default.ts
// already use when a tenant has no lat/lon on file - kept in sync with
// those, not re-derived. (Redundant once every real tenant has values
// via the new /config Airfield Location section - see the Phase 3
// deploy notes for this round, not touched here.)
const SHOBDON_LATITUDE = 52.2416;
const SHOBDON_LONGITUDE = -2.8821;

const NOTAM_RADIUS_NM = 8;
const NOTAM_DATA_TTL_SECONDS = 24 * 60 * 60; // 24h floor - always-present last-known-good
const NOTAM_FRESH_TTL_SECONDS = 12 * 60; // 10-15 min sentinel, active hours only
const ACTIVE_HOURS_START = 7;
const ACTIVE_HOURS_END = 19;

interface TenantLocationRow {
  icaoCode: string | null;
  lat: number | null;
  lon: number | null;
}

type NotamSeverity = "critical" | "warning" | "info";

interface NotamEntry {
  id: string;
  icao: string;
  text: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  severity: NotamSeverity;
}

interface NotamProviderResult {
  fetchedAt: string;
  notams: NotamEntry[];
}

type CacheSource = "live" | "cached" | "stale-fallback" | "none";

// 07:00-19:00 Europe/London, resolved via Intl.DateTimeFormat rather than
// a fixed UTC offset - a fixed offset would silently be wrong for half
// the year across the BST/GMT transition. hourCycle: 'h23' pinned
// explicitly rather than relying on hour12: false, which has known
// midnight-as-"24" quirks in some environments.
function isActiveHoursLondon(now: Date): boolean {
  const hourString = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hourCycle: "h23",
    hour: "numeric",
  }).format(now);
  const hour = Number(hourString);
  return hour >= ACTIVE_HOURS_START && hour < ACTIVE_HOURS_END;
}

// Keyed by resolved airfield, not by tenant - if a second tenant later
// shares an airfield, they share one cache entry (and one upstream call
// budget) rather than fragmenting it per-tenant. ICAO preferred when
// available (most precise, most likely to match how a real provider
// indexes NOTAMs); rounded lat/lon + radius otherwise.
function buildCacheKey(icao: string | null, lat: number, lon: number, radiusNm: number): string {
  if (icao) return `icao:${icao}:r${radiusNm}`;
  return `geo:${lat.toFixed(2)},${lon.toFixed(2)}:r${radiusNm}`;
}

// Simple heuristic, not exhaustive - runway/airfield closures are the
// only thing that must never be missed, obstacles/unserviceable
// equipment/works-in-progress are worth flagging but not blocking,
// everything else is informational.
function classifySeverity(text: string): NotamSeverity {
  const upper = text.toUpperCase();
  if (/\bRWY\b[^.]*\bCLSD\b|\bCLSD\b[^.]*\bRWY\b|\bAD\s+CLSD\b|AERODROME\s+CLOSED|RUNWAY\s+CLOSED/.test(upper)) {
    return "critical";
  }
  if (/\bOBST\b|OBSTACLE|UNSERVICEABLE|\bU\/S\b|WORK\s+IN\s+PROGRESS|\bWIP\b/.test(upper)) {
    return "warning";
  }
  return "info";
}

interface NotamProvider {
  fetch(icao: string | null, lat: number, lon: number): Promise<NotamProviderResult | null>;
}

// UNVERIFIED against a live response - see this file's top comment.
// Written defensively against FAA's publicly documented NOTAM API v1
// GeoJSON response shape (items[].properties.coreNOTAMData.notam); any
// field that doesn't match what's expected is simply skipped rather than
// thrown, so a shape mismatch degrades to "fewer/no NOTAMs parsed", never
// a 500.
function parseFaaResponse(json: unknown, fallbackIcao: string | null): NotamProviderResult {
  const items = (json as { items?: unknown[] } | null)?.items;
  const notams: NotamEntry[] = [];

  if (Array.isArray(items)) {
    for (const item of items) {
      const notam = (item as { properties?: { coreNOTAMData?: { notam?: Record<string, unknown> } } } | null)
        ?.properties?.coreNOTAMData?.notam;
      if (!notam) continue;

      const text =
        typeof notam.text === "string" && notam.text.trim()
          ? notam.text.trim()
          : typeof notam.icaoMessage === "string" && notam.icaoMessage.trim()
            ? notam.icaoMessage.trim()
            : null;
      if (!text) continue;

      notams.push({
        id: typeof notam.id === "string" && notam.id ? notam.id : crypto.randomUUID(),
        icao: typeof notam.location === "string" && notam.location ? notam.location : (fallbackIcao ?? ""),
        text,
        effectiveFrom: typeof notam.effectiveStart === "string" ? notam.effectiveStart : null,
        effectiveTo: typeof notam.effectiveEnd === "string" ? notam.effectiveEnd : null,
        severity: classifySeverity(text),
      });
    }
  }

  return { fetchedAt: new Date().toISOString(), notams };
}

const FAA_NOTAM_API_URL = "https://external-api.faa.gov/notamapi/v1/notams";

function createFaaProvider(env: Env): NotamProvider | null {
  if (!env.FAA_NOTAM_CLIENT_ID || !env.FAA_NOTAM_CLIENT_SECRET) return null;
  const clientId = env.FAA_NOTAM_CLIENT_ID;
  const clientSecret = env.FAA_NOTAM_CLIENT_SECRET;

  return {
    async fetch(icao, lat, lon) {
      const params = new URLSearchParams({ responseFormat: "geoJson" });
      if (icao) {
        params.set("icaoLocation", icao);
      } else {
        params.set("locationLatitude", String(lat));
        params.set("locationLongitude", String(lon));
        params.set("locationRadius", String(NOTAM_RADIUS_NM));
      }

      const response = await fetch(`${FAA_NOTAM_API_URL}?${params.toString()}`, {
        headers: { client_id: clientId, client_secret: clientSecret },
      });
      if (!response.ok) return null;

      const json = await response.json().catch(() => null);
      if (!json) return null;
      return parseFaaResponse(json, icao);
    },
  };
}

// Generic fallback slot for a real second, UK-capable provider (e.g.
// Laminar Data Hub) later - config-driven, currently always inert since
// NOTAM_PROVIDER_BASE_URL/NOTAM_PROVIDER_API_KEY are never set anywhere.
// Deliberately returns null (a genuine no-op), not a throw, if these ever
// get set before real fetch logic is written here.
function createGenericProvider(env: Env): NotamProvider | null {
  if (!env.NOTAM_PROVIDER_BASE_URL || !env.NOTAM_PROVIDER_API_KEY) return null;
  return {
    async fetch() {
      return null;
    },
  };
}

function getProvider(env: Env): NotamProvider | null {
  return createFaaProvider(env) ?? createGenericProvider(env);
}

async function fetchFromProvider(provider: NotamProvider, icao: string | null, lat: number, lon: number): Promise<NotamProviderResult | null> {
  try {
    return await provider.fetch(icao, lat, lon);
  } catch {
    return null;
  }
}

async function resolveNotams(
  env: Env,
  provider: NotamProvider,
  cacheKey: string,
  icao: string | null,
  lat: number,
  lon: number,
  active: boolean
): Promise<{ payload: NotamProviderResult; source: CacheSource }> {
  const dataKey = `notam:data:${cacheKey}`;
  const freshKey = `notam:fresh:${cacheKey}`;

  const cached = await env.WEATHER_CACHE.get<NotamProviderResult>(dataKey, "json");

  if (active) {
    const freshSentinel = await env.WEATHER_CACHE.get(freshKey);
    if (freshSentinel && cached) {
      return { payload: cached, source: "cached" };
    }

    const fetched = await fetchFromProvider(provider, icao, lat, lon);
    if (fetched) {
      await env.WEATHER_CACHE.put(dataKey, JSON.stringify(fetched), { expirationTtl: NOTAM_DATA_TTL_SECONDS });
      await env.WEATHER_CACHE.put(freshKey, "1", { expirationTtl: NOTAM_FRESH_TTL_SECONDS });
      return { payload: fetched, source: "live" };
    }

    // Upstream failed - a blank panel is worse than a slightly old one.
    if (cached) return { payload: cached, source: "stale-fallback" };
    return { payload: { fetchedAt: new Date().toISOString(), notams: [] }, source: "none" };
  }

  // Off-hours: the fresh sentinel is never consulted here, by design -
  // serve `data` directly regardless of its age (up to the 24h floor
  // TTL), and only touch upstream at all if there's genuinely no data
  // yet (cold start), doing exactly one fetch in that case.
  if (cached) return { payload: cached, source: "cached" };

  const fetched = await fetchFromProvider(provider, icao, lat, lon);
  if (fetched) {
    await env.WEATHER_CACHE.put(dataKey, JSON.stringify(fetched), { expirationTtl: NOTAM_DATA_TTL_SECONDS });
    await env.WEATHER_CACHE.put(freshKey, "1", { expirationTtl: NOTAM_FRESH_TTL_SECONDS });
    return { payload: fetched, source: "live" };
  }
  return { payload: { fetchedAt: new Date().toISOString(), notams: [] }, source: "none" };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const host = request.headers.get("host");
  if (!host) return jsonResponse({ error: "Missing Host header" }, 400);

  const tenant = await resolveTenantFromHost(host, env.DB);
  if (!tenant) return jsonResponse({ error: "Unknown tenant host" }, 404);

  const row = await env.DB
    .prepare("SELECT icao_code AS icaoCode, lat, lon FROM tenants WHERE id = ?")
    .bind(tenant.id)
    .first<TenantLocationRow>();

  const icao = row?.icaoCode ?? null;
  const lat = row?.lat ?? SHOBDON_LATITUDE;
  const lon = row?.lon ?? SHOBDON_LONGITUDE;

  const provider = getProvider(env);

  // No provider configured anywhere - skip cache entirely (nothing would
  // ever be cached) and return the documented no-op shape immediately.
  // Safe to ship and turn the dashboard toggle on before real credentials
  // land; this just quietly does nothing until they do.
  if (!provider) {
    return jsonResponse({
      icao,
      lat,
      lon,
      radiusNm: NOTAM_RADIUS_NM,
      fetchedAt: null,
      notams: [],
      providerConfigured: false,
      cache: { source: "none", servedAt: new Date().toISOString() },
    });
  }

  const cacheKey = buildCacheKey(icao, lat, lon, NOTAM_RADIUS_NM);
  const active = isActiveHoursLondon(new Date());
  const { payload, source } = await resolveNotams(env, provider, cacheKey, icao, lat, lon, active);

  return jsonResponse({
    icao,
    lat,
    lon,
    radiusNm: NOTAM_RADIUS_NM,
    fetchedAt: payload.fetchedAt,
    notams: payload.notams,
    providerConfigured: true,
    cache: { source, servedAt: new Date().toISOString() },
  });
};
