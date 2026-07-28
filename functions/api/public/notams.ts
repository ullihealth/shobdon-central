// Public, UNAUTHENTICATED automated NOTAM feed - GET /api/public/notams.
// Host-resolved tenant, same pattern as weather-metoffice.ts/
// weather-default.ts. Consumed by RightInfoPanel.tsx's "Runway In Use"
// state, gated client-side on the same ops_panel_state.showAutoNotams
// flag /atc-control's "Automated NOTAM Feed" toggle already controls.
//
// Active provider: NOTAMinfo (notaminfo.com), a free RSS feed tied to a
// registered account (NOTAMINFO_FEED_URL, e.g.
// https://notaminfo.com/feed?u=Jeff%20Thompson) - confirmed live and
// working against a real 7-item pull. It's an AREA feed, not a
// point/radius query - most items are nationwide/administrative
// notices with nothing to do with any one airfield, so this file does
// its own geographic filtering (see parseQLineLocation/
// parseNotamInfoFeed below) rather than trusting every item the feed
// returns. FAA_NOTAM_CLIENT_ID/SECRET remain wired but unconfigured -
// kept as a fallback slot, not the active path (see the FAA-specific
// comment further down for its own unresolved UK-coverage caveat).
// NOTAMINFO_FEED_URL takes priority in getProvider() below.

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
  // NOTAMinfo (notaminfo.com) - the active provider. A per-account RSS
  // feed URL, not a per-request API key/secret pair - confirmed live,
  // see this file's top comment.
  NOTAMINFO_FEED_URL?: string;
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
// 240 minutes = the feed's own declared <ttl>, confirmed directly
// against a live pull (not guessed) - replaces the old 10-15min/12h
// active-hours split entirely. That finer-grained, time-of-day-aware
// gating existed to conserve calls against a paid, per-request-priced
// API; NOTAMinfo is a free, account-based feed with its own stated
// refresh cadence, so there's no reason to vary caching behaviour by
// time of day at all - always just respect the feed's own number.
const NOTAM_FRESH_TTL_SECONDS = 240 * 60;

// Real-world evidence this needed to be looser than "must be within the
// item's own declared radius": Shobdon's real coordinates
// (52.2416, -2.8821) are ~4.3nm from the Eyton crane NOTAM's parsed
// point (5215N00246W, radius 001) - well outside that item's own 1nm
// radius, yet it's a genuinely relevant local notice (confirmed against
// the real feed pull). The item's own radius is used ONLY to separate
// "a real, specific point notice" from the 999nm blanket/nationwide
// sentinel (see parseNotamInfoFeed below) - actual relevance-to-tenant
// is judged against this single, more generous, fixed cutoff instead.
const NOTAM_LOCAL_RADIUS_CUTOFF_NM = 50;
const EARTH_RADIUS_NM = 3440.065;

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

// Keyed by resolved airfield, not by tenant - if a second tenant later
// shares an airfield, they share one cache entry (and one upstream call
// budget) rather than fragmenting it per-tenant. ICAO preferred when
// available (most precise, most likely to match how a real provider
// indexes NOTAMs); rounded lat/lon + radius otherwise.
//
// Known imprecision for NOTAMinfo specifically: this feed is a single
// account-wide feed (NOTAMINFO_FEED_URL), not a per-location query, so
// two tenants with different coordinates genuinely cause two separate
// upstream fetches of the exact same feed content, each then filtered
// differently. Harmless today (Shobdon is still the only real tenant)
// and not worth restructuring the cache around pre-emptively - revisit
// if/when a second tenant with automated NOTAMs actually onboards.
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

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface QLineLocation {
  lat: number;
  lon: number;
  radiusNm: number;
}

// NOTAMinfo's <description> opens with a raw ICAO-format Q-line whose
// final '/'-delimited segment is always a 14-character coordinate+radius
// token, e.g. "5215N00253W005" - DDMM[N/S] (5 chars, latitude) +
// DDDMM[E/W] (6 chars, longitude) + a 3-digit radius in nautical miles.
// Confirmed against a real 7-item pull of this exact feed, not guessed
// from spec alone. The Q-line is always followed by a double <br><br>
// before the human-readable <pre> text - splitting on that is how the
// Q-line itself gets isolated here.
function parseQLineLocation(rawDescription: string): QLineLocation | null {
  const qLine = rawDescription.split(/&lt;br&gt;&lt;br&gt;|<br\s*\/?>\s*<br\s*\/?>/i)[0];
  const segments = qLine.split("/");
  const token = segments[segments.length - 1]?.trim();
  if (!token) return null;

  const match = token.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})$/);
  if (!match) return null;

  const [, latDeg, latMin, latHem, lonDeg, lonMin, lonHem, radius] = match;
  const lat = (Number(latDeg) + Number(latMin) / 60) * (latHem === "S" ? -1 : 1);
  const lon = (Number(lonDeg) + Number(lonMin) / 60) * (lonHem === "W" ? -1 : 1);
  return { lat, lon, radiusNm: Number(radius) };
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// Strips the raw Q-line and HTML markup, keeping the human-readable
// summary plus the LOWER/UPPER/FROM/TO/SCHEDULE lines that follow it -
// what a reader actually needs, without the machine-oriented Q-line
// prefix or raw <pre>/<br> tags. effectiveFrom/effectiveTo are left null
// on these entries rather than parsed out of the "FROM: ... TO: ..."
// text (a free-text date format, e.g. "19 Jul 2026 08:15 GMT (09:15
// BST)") - that text stays readable to a human either way, and a
// bespoke parser for it wasn't asked for this round.
function cleanNotamInfoText(rawDescription: string): string {
  const decoded = decodeXmlEntities(rawDescription);
  const afterQLine = decoded.replace(/^[^<]*<br\s*\/?>\s*<br\s*\/?>/i, "");
  return afterQLine
    .replace(/<pre>/gi, "")
    .replace(/<\/pre>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTagContent(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : null;
}

// Plain regex-based extraction, not a real XML parser - Workers has no
// DOMParser, and this feed's structure is regular/predictable enough
// (confirmed against a real pull: no CDATA anywhere, one <item> per
// NOTAM) that a hand-rolled parser is a reasonable fit, matching this
// codebase's existing convention (worker/src/index.ts's own
// extractFieldsById for the ATC weather-station page).
//
// Geographic filtering, not name-matching: most items in a real pull are
// nationwide/administrative notices with a 999nm Q-line radius (the
// standard NOTAM convention for "affects the whole FIR/country", not a
// real distance) - those are always dropped regardless of how close
// their nominal point happens to be. Genuinely local items carry a real,
// small radius. Actual relevance-to-tenant is judged against the fixed
// NOTAM_LOCAL_RADIUS_CUTOFF_NM, not the item's own (often much smaller)
// declared radius - see that constant's own comment for the concrete
// real-world case (the Eyton crane NOTAM) that ruled out the more
// literal reading.
function parseNotamInfoFeed(xml: string, fallbackIcao: string | null, tenantLat: number, tenantLon: number): NotamProviderResult {
  const notams: NotamEntry[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  for (const block of itemBlocks) {
    const guid = extractTagContent(block, "guid");
    const rawDescription = extractTagContent(block, "description");
    if (!rawDescription) continue;

    const location = parseQLineLocation(rawDescription);
    if (!location) continue;
    if (location.radiusNm >= NOTAM_LOCAL_RADIUS_CUTOFF_NM) continue;

    const distanceNm = haversineNm(tenantLat, tenantLon, location.lat, location.lon);
    if (distanceNm > NOTAM_LOCAL_RADIUS_CUTOFF_NM) continue;

    const text = cleanNotamInfoText(rawDescription);
    if (!text) continue;

    notams.push({
      id: guid ?? crypto.randomUUID(),
      icao: fallbackIcao ?? "",
      text,
      effectiveFrom: null,
      effectiveTo: null,
      severity: classifySeverity(text),
    });
  }

  return { fetchedAt: new Date().toISOString(), notams };
}

function createNotamInfoProvider(env: Env): NotamProvider | null {
  if (!env.NOTAMINFO_FEED_URL) return null;
  const feedUrl = env.NOTAMINFO_FEED_URL;

  return {
    async fetch(icao, lat, lon) {
      const response = await fetch(feedUrl);
      if (!response.ok) return null;
      const xml = await response.text();
      return parseNotamInfoFeed(xml, icao, lat, lon);
    },
  };
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
  return createNotamInfoProvider(env) ?? createFaaProvider(env) ?? createGenericProvider(env);
}

async function fetchFromProvider(provider: NotamProvider, icao: string | null, lat: number, lon: number): Promise<NotamProviderResult | null> {
  try {
    return await provider.fetch(icao, lat, lon);
  } catch {
    return null;
  }
}

// No more active-hours branching - that time-of-day split existed only
// to conserve calls to a paid, per-request-priced API (see
// NOTAM_FRESH_TTL_SECONDS's own comment). This now always follows the
// same single path, 24/7: serve straight from cache while the fresh
// sentinel holds (up to 240 minutes, the feed's own declared cadence);
// otherwise refetch, and on a failed refetch fall back to whatever's in
// `data` (up to its own longer 24h floor) rather than a hard error.
async function resolveNotams(
  env: Env,
  provider: NotamProvider,
  cacheKey: string,
  icao: string | null,
  lat: number,
  lon: number
): Promise<{ payload: NotamProviderResult; source: CacheSource }> {
  const dataKey = `notam:data:${cacheKey}`;
  const freshKey = `notam:fresh:${cacheKey}`;

  const cached = await env.WEATHER_CACHE.get<NotamProviderResult>(dataKey, "json");
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
  const { payload, source } = await resolveNotams(env, provider, cacheKey, icao, lat, lon);

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
