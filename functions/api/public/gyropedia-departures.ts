// Public, UNAUTHENTICATED UK gyroplane departures/arrivals feed - GET
// /api/public/gyropedia-departures. Genuinely tenant-agnostic (no Host
// resolution, no organizationId anywhere in this file) - every tenant's
// "Gyropedia Departures/Arrivals" carousel slot hits this exact same
// endpoint and gets the exact same data, same as PUBLIC_TENANTS_URL's
// own cross-tenant posture. Same dataKey/freshKey KV shape as
// functions/api/public/notams.ts's resolveNotams - see that file's own
// comment for why a blank panel is worse than a slightly old one.
//
// Source: https://gyropedia.com/monitor.php, confirmed live (not
// assumed) to return a plain HTML page with a `<table>` of
// `<tr class="itemrow">` rows, 8 `<td>`s each: Status (Scheduled/Landed/
// Flying/etc), Country, Out, In, Aircraft, Type, Persons, Remark. Out/In
// each carry a place name plus an optional `<small>` sub-element with a
// time. Permission to use this feed confirmed directly with a member of
// the source organisation (IAPGT/Gyropedia) - not a scraping/ToS
// concern.

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Response | Promise<Response>;

type KVNamespace = {
  get: {
    <T = unknown>(key: string, type: "json"): Promise<T | null>;
    (key: string): Promise<string | null>;
  };
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

type D1Database = {
  prepare: (query: string) => { first: <T>() => Promise<T | null> };
};

interface Env {
  DB: D1Database;
  WEATHER_CACHE: KVNamespace;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const GYROPEDIA_URL = "https://gyropedia.com/monitor.php";
const CACHE_KEY = "gyropedia:uk-departures";
// 24h floor - a genuine last-known-good, same posture as
// NOTAM_DATA_TTL_SECONDS. Only ever overwritten by a fresh successful
// fetch, never expires away during a longer Gyropedia outage than that
// - it just stops being "fresh" (see freshKey below) and keeps serving
// as the stale-fallback.
const DATA_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_REFRESH_INTERVAL_MINUTES = 15;

interface GyropediaPlace {
  place: string;
  time: string;
}

interface GyropediaRow {
  status: string;
  out: GyropediaPlace;
  in: GyropediaPlace;
  aircraft: string;
  type: string;
  persons: string;
  remark: string;
}

interface GyropediaPayload {
  fetchedAt: string;
  rows: GyropediaRow[];
}

type CacheSource = "live" | "cached" | "stale-fallback" | "none";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Strips the nested <small> sub-value (time, handled separately by
// extractSmallText below) before turning <br> into a space and any
// remaining tags into nothing - confirmed against a real pull: this is
// exactly what turns "United<br>Kingdom" into "United Kingdom" and
// "Wayne Mitchell<br>Ethan tif" into "Wayne Mitchell Ethan tif".
function cleanCellText(raw: string): string {
  const withoutSmall = raw.replace(/<small>[\s\S]*?<\/small>/gi, "");
  const withBreaksAsSpaces = withoutSmall.replace(/<br\s*\/?>/gi, " ");
  const stripped = withBreaksAsSpaces.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim();
}

function extractSmallText(raw: string): string {
  const match = raw.match(/<small>([\s\S]*?)<\/small>/i);
  if (!match) return "";
  return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function parsePlaceTime(raw: string): GyropediaPlace {
  return { place: cleanCellText(raw), time: extractSmallText(raw) };
}

// Plain regex-based extraction, not a real HTML parser - matching this
// codebase's existing convention for structured field extraction from a
// raw fetched page (worker/src/index.ts's parseRunway/parseWind/etc,
// notams.ts's parseNotamInfoFeed) rather than a parsing library, which
// this repo has none of and Workers has no DOM for anyway. Confirmed
// against a real pull (5 rows, 2 United Kingdom) before writing this -
// any row that doesn't have exactly 8 <td>s is skipped rather than
// thrown, so a future markup tweak on Gyropedia's side degrades to
// "fewer rows parsed", never a 500.
function parseGyropediaRows(html: string): GyropediaRow[] {
  const rows: GyropediaRow[] = [];
  const rowMatches = html.matchAll(/<tr class="itemrow">([\s\S]*?)<\/tr>/g);

  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length !== 8) continue;

    const [status, country, out, into, aircraft, type, persons, remark] = cells;
    // Country is only ever used to filter, then dropped - redundant on
    // every row once every remaining row is known to be the same value.
    if (cleanCellText(country) !== "United Kingdom") continue;

    rows.push({
      status: cleanCellText(status),
      out: parsePlaceTime(out),
      in: parsePlaceTime(into),
      aircraft: cleanCellText(aircraft),
      type: cleanCellText(type),
      persons: cleanCellText(persons),
      remark: cleanCellText(remark),
    });
  }

  return rows;
}

async function fetchGyropedia(): Promise<GyropediaPayload | null> {
  try {
    const response = await fetch(GYROPEDIA_URL);
    if (!response.ok) return null;
    const html = await response.text();
    return { fetchedAt: new Date().toISOString(), rows: parseGyropediaRows(html) };
  } catch {
    return null;
  }
}

async function resolveRefreshIntervalMinutes(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM platform_settings WHERE key = 'gyropedia_refresh_interval_minutes'")
    .first<{ value: string }>();
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_INTERVAL_MINUTES;
}

// Same dataKey/freshKey shape as notams.ts's resolveNotams - serve
// straight from cache while the fresh sentinel holds (its own TTL is
// the developer-configurable interval, read fresh on every miss rather
// than baked into a constant); otherwise refetch, and on a failed
// refetch fall back to whatever's in `data` rather than an empty panel.
async function resolveGyropedia(env: Env): Promise<{ payload: GyropediaPayload; source: CacheSource }> {
  const dataKey = `${CACHE_KEY}:data`;
  const freshKey = `${CACHE_KEY}:fresh`;

  const cached = await env.WEATHER_CACHE.get<GyropediaPayload>(dataKey, "json");
  const freshSentinel = await env.WEATHER_CACHE.get(freshKey);
  if (freshSentinel && cached) {
    return { payload: cached, source: "cached" };
  }

  const fetched = await fetchGyropedia();
  if (fetched) {
    const intervalMinutes = await resolveRefreshIntervalMinutes(env.DB);
    await env.WEATHER_CACHE.put(dataKey, JSON.stringify(fetched), { expirationTtl: DATA_TTL_SECONDS });
    await env.WEATHER_CACHE.put(freshKey, "1", { expirationTtl: intervalMinutes * 60 });
    return { payload: fetched, source: "live" };
  }

  // Upstream failed - a blank panel is worse than a slightly old one.
  if (cached) return { payload: cached, source: "stale-fallback" };
  return { payload: { fetchedAt: new Date().toISOString(), rows: [] }, source: "none" };
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { payload, source } = await resolveGyropedia(env);

  return jsonResponse({
    fetchedAt: payload.fetchedAt,
    rows: payload.rows,
    cache: { source, servedAt: new Date().toISOString() },
  });
};
