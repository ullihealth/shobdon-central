// Shobdon Central - remote capture log
//
// Minimal store-and-view endpoint for weather station capture reports, so a
// capture run on ATC PC2 can be viewed from anywhere afterward. KV only, by
// design: no schema has been designed yet because no real capture has moved
// through the real relay/station pipeline yet. The stored payload is a
// self-contained JSON blob (the full report text plus the structured fields
// already captured client-side) - when a D1 historical store is built later,
// it can be written to alongside this KV write without changing this
// endpoint's contract or tearing anything down.
//
// Auth is a single shared-secret query param (?key=...), checked on every
// method. Not hardened - just enough that this isn't an open, indexable log.

// Platform weather-fallback cron round - genuinely imported (not
// duplicated) from the main app's own source tree, unlike
// WIND_DIR_MIN_DEG/isPlausibleCapture below (which ARE duplicated, see
// that comment for why: no shared module existed for those before now).
// Confirmed this specific cross-directory relative import bundles
// cleanly under this Worker's own `wrangler deploy` (dry-run tested
// directly, not assumed) - both files are plain TypeScript with only
// type-only imports of their own, nothing browser/Pages-Functions-
// specific, so nothing about being bundled into a separately-deployed
// Worker changes their behaviour. Reusing the actual function (not a
// second implementation) is what the platform weather-fallback design
// explicitly called for - the UK Met Office model preference, the
// fallback-to-default-blend retry, and the exact field mapping all stay
// in the one place every other caller (manually-selected 'internet'
// provider, WeatherContext's own 'atc' fallback) already relies on.
import { fetchOpenMeteoWeather } from '../../src/services/internetProviders/openMeteo'
import type { WeatherConfig } from '../../src/types/weatherConfig'

// Minimal local D1 binding type - same "hand-roll a narrow local type
// rather than pull in a dependency" convention MinimalExecutionContext
// below already establishes, matching the shape functions/api/_utils/
// tenantAuth.ts's own D1Database type already uses for the identical
// reason there. Added for the platform weather-fallback cron
// (runWeatherFallbackCheck below) - this Worker previously had no D1
// access at all, communicating with the database only indirectly via
// forwardToIngest's authenticated HTTP call to the Pages Functions app.
export type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      run: () => Promise<{ success: boolean }>
      first: <T = Record<string, unknown>>() => Promise<T | null>
      all: <T = unknown>() => Promise<{ results: T[] }>
    }
  }
}

export interface Env {
  CAPTURES: KVNamespace
  CAPTURE_KEY: string
  // Real per-tenant key for Shobdon's own tenants row (functions/api/
  // tenant/api-keys), used only to forward already-parsed readings to
  // the generic, genuinely multi-tenant ingestion endpoint - see
  // forwardToIngest's own comment for the full story. Set via
  // `wrangler secret put SHOBDON_INGEST_KEY` from this directory, never
  // committed - same posture as CAPTURE_KEY already has via wrangler.toml
  // + the Cloudflare dashboard.
  SHOBDON_INGEST_KEY?: string
  // Platform weather-fallback cron round - same production D1 database
  // functions/ already binds as `DB` (wrangler.toml, database_id
  // 31656f0d-...), bound here too so runWeatherFallbackCheck can read
  // every station-owning ('atc') tenant and write a Met Office/SAWS
  // fallback reading on their behalf, system-level, without needing a
  // per-tenant API key (see that function's own comment for why the
  // existing SHOBDON_INGEST_KEY pattern above doesn't generalize to
  // this job).
  DB: D1Database
}

// Minimal structural subset of the real Workers ExecutionContext - just
// the one method this file actually calls, matching this project's own
// established "hand-roll a narrow local type rather than pull in a
// dependency" convention (see functions/api/_utils/tenantAuth.ts's own
// D1Database for the same pattern). Avoids needing @cloudflare/workers-
// types as a real dependency in this directory, which has none today.
interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

// Same minimal-local-type convention as MinimalExecutionContext above -
// only the one field runWeatherFallbackCheck's own trigger actually
// wants to log, not the full real Workers ScheduledController shape.
interface MinimalScheduledEvent {
  cron: string
}

const MAX_HISTORY = 20
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

interface CaptureEntry {
  receivedAt: string
  payload: unknown
}

interface InvestigationEntry {
  check: string
  label: string
  loggedAt: string
}

const MAX_INVESTIGATIONS = 50

function checkKey(request: Request, env: Env): boolean {
  const key = new URL(request.url).searchParams.get('key')
  return !!key && !!env.CAPTURE_KEY && key === env.CAPTURE_KEY
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Remote-refresh trigger: a persistent per-tenant timestamp in the same KV
// namespace, gated by the same shared key. GET /refresh sets it (so opening
// the URL on a phone is enough - no button/JS required); GET /refresh-check
// is polled by the app and returns the CURRENT stored timestamp - never
// deletes it. The "don't interrupt an in-progress capture" logic, and now
// also "have I already acted on this specific timestamp" logic, both live
// entirely client-side (RemoteRefreshWatcher.tsx).
//
// Platform "refresh displays" round - this used to be ONE global key, read
// by every tenant's dashboard regardless of which tenant it belonged to.
// Found in review that this was already a live, unintentional side effect:
// AtcControlPage.tsx's "Update Dashboard" save calls this same trigger to
// reload the dashboard it just changed, which meant saving ANY tenant's ops
// panel silently reloaded EVERY OTHER tenant's live screen too. The key is
// now namespaced per tenant slug so a refresh only ever affects the tenant
// it names - REFRESH_ALL_SENTINEL below is the one deliberate exception,
// and it fans out by writing that same per-tenant key for every tenant
// individually (server-side), not by inventing a second "everyone" flag
// concept that RemoteRefreshWatcher would need its own separate polling
// path for.
//
// Multi-consumer round 2 (2026-08-31) - this used to be delete-on-read
// (whichever poller's GET reached the Worker first consumed and cleared
// it, silently starving every other simultaneous poller with zero error).
// Confirmed as a real, live bug once a tenant's OWN dashboard could be
// embedded as a carousel "website" slide on a SECOND tenant's kiosk
// (Meg's Cafe embedding Shobdon's own '/') - that embed runs Shobdon's
// real app, including its own RemoteRefreshWatcher instance, so Shobdon's
// per-tenant flag now legitimately has two independent, simultaneous
// consumers (its own real kiosk, and Meg's embedded copy), not just the
// one the original delete-on-read design assumed. display_visits
// confirmed two distinct devices polling the same "main" display
// concurrently. Fixed by making the read side non-consuming: any number
// of independent pollers can now check the same timestamp as often as
// they like without affecting each other - see RemoteRefreshWatcher.tsx's
// own comment for the client-side half (treating the first-ever read as
// a baseline, not a trigger, so this doesn't need re-introducing
// consumption to avoid an infinite reload loop).
function refreshFlagKey(tenantSlug: string): string {
  return `refresh-requested:${tenantSlug}`
}

// 24h - generous enough that a display that's been offline overnight
// still correctly catches up on the most recent trigger once it's back,
// short enough that KV doesn't accumulate genuinely-forgotten per-tenant
// keys forever now that reads no longer delete them. Purely a storage/
// hygiene bound, not a correctness requirement - a poller's own
// per-client baseline (see RemoteRefreshWatcher.tsx) is what actually
// prevents a stale timestamp from ever re-triggering a reload.
const REFRESH_FLAG_TTL_SECONDS = 24 * 60 * 60

// Bare `/refresh?key=...` with no `?tenant=` - PC2's own phone-bookmark
// shortcut, unchanged since before per-tenant scoping existed. Must keep
// meaning exactly what it always has (refresh Shobdon's own display),
// never silently reinterpreted as "refresh everyone" just because this
// route grew tenant-awareness for other callers.
const DEFAULT_REFRESH_TENANT_SLUG = 'shobdon'

const REFRESH_ALL_SENTINEL = 'all'

// Dynamic, not hardcoded - same query shape runWeatherFallbackCheck already
// uses to enumerate tenants, so a future tenant is included in "refresh all"
// automatically, with no per-tenant wiring here either.
async function fetchActiveTenantSlugs(env: Env): Promise<string[]> {
  const { results } = await env.DB
    .prepare('SELECT slug FROM tenants WHERE active = 1 AND deleted_at IS NULL')
    .bind()
    .all<{ slug: string }>()
  return results.map((row) => row.slug)
}

async function handleSetRefreshFlag(request: Request, env: Env): Promise<Response> {
  const tenantParam = new URL(request.url).searchParams.get('tenant') || DEFAULT_REFRESH_TENANT_SLUG

  let summary: string
  if (tenantParam === REFRESH_ALL_SENTINEL) {
    const slugs = await fetchActiveTenantSlugs(env)
    await Promise.all(
      slugs.map((slug) => env.CAPTURES.put(refreshFlagKey(slug), new Date().toISOString(), { expirationTtl: REFRESH_FLAG_TTL_SECONDS }))
    )
    summary = `${slugs.length} tenant display${slugs.length === 1 ? '' : 's'}`
  } else {
    await env.CAPTURES.put(refreshFlagKey(tenantParam), new Date().toISOString(), { expirationTtl: REFRESH_FLAG_TTL_SECONDS })
    summary = `"${tenantParam}"`
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Shobdon Central - Refresh Requested</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#03101a; color:#e2e8f0; padding:2rem; max-width:600px; margin:0 auto; text-align:center;">
  <h1 style="font-size:1.25rem;">✅ Refresh requested</h1>
  <p style="color:#94a3b8;">Flagged for ${escapeHtml(summary)}. Live displays will pick this up within about 15
  seconds - immediately if idle, or right after any in-progress capture finishes.</p>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
  })
}

async function handleCheckRefreshFlag(request: Request, env: Env): Promise<Response> {
  const tenantParam = new URL(request.url).searchParams.get('tenant') || DEFAULT_REFRESH_TENANT_SLUG
  const key = refreshFlagKey(tenantParam)

  // Non-consuming read - see this key's own refreshFlagKey() comment
  // ("Multi-consumer round 2") for why this must never delete on read
  // anymore. refreshRequestedAt is the raw stored ISO timestamp (or
  // null if no refresh has ever been requested for this tenant, or the
  // 24h TTL has since expired it) - RemoteRefreshWatcher.tsx is what
  // decides whether a given value is "new since I last checked".
  const refreshRequestedAt = await env.CAPTURES.get(key)

  return new Response(JSON.stringify({ refreshRequestedAt: refreshRequestedAt ?? null }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// One-tap station investigation logging: a preset check name + preset label,
// no free text. Kept in its own KV list (separate from capture history) so
// it's easy to tell apart when reviewing later.
async function handleLogInvestigation(request: Request, env: Env): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  const body = payload as { check?: unknown; label?: unknown }
  const check = typeof body.check === 'string' ? body.check : 'unknown'
  const label = typeof body.label === 'string' ? body.label : 'unknown'

  const entry: InvestigationEntry = { check, label, loggedAt: new Date().toISOString() }

  const raw = await env.CAPTURES.get('investigations')
  const investigations: InvestigationEntry[] = raw ? JSON.parse(raw) : []
  investigations.unshift(entry)
  investigations.length = Math.min(investigations.length, MAX_INVESTIGATIONS)

  await env.CAPTURES.put('investigations', JSON.stringify(investigations))

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ── WeatherLink adisp.php parsing ───────────────────────────────────────
// Real field IDs confirmed from a live capture. Each field gets its own
// small named function so a future WeatherLink format change only requires
// touching the one function for the field that changed.

const KNOWN_FIELD_IDS = [
  'RWY', 'QNH', 'QFE', 'WIND', 'AVGWSPEED', 'TEMPDEW',
  'Time', 'UTCDATE', 'LOCALTIME', 'WATCHDOG', 'NOTAMSBOX',
]

// HTMLRewriter's text() hands back RAW text - entities like &deg; are not
// decoded to °. Decode the handful that actually show up in this page's
// fields so every parser below can match against real Unicode characters
// regardless of whether the station emits literal UTF-8 or entities.
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&deg;/gi, '°')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

// Extracts the text content of every element that has an `id` attribute,
// using the Workers runtime's built-in HTMLRewriter - no parsing library
// needed. Elements not in KNOWN_FIELD_IDS are left for the caller to route
// into raw_unparsed rather than silently dropping them.
async function extractFieldsById(html: string): Promise<Record<string, string>> {
  const fields: Record<string, string> = {}
  let currentId: string | null = null

  const rewriter = new HTMLRewriter().on('[id]', {
    element(el: Element) {
      const id = el.getAttribute('id')
      if (!id) return
      currentId = id
      fields[id] = fields[id] ?? ''
      el.onEndTag(() => {
        currentId = null
      })
    },
    text(chunk: Text) {
      if (currentId) {
        fields[currentId] += chunk.text
      }
    },
  })

  await rewriter.transform(new Response(html)).text()

  for (const id of Object.keys(fields)) {
    fields[id] = decodeHtmlEntities(fields[id])
  }

  return fields
}

// "RWY 26 LH" -> { runway: "26", hand: "LH" }. Also "RWY 08RH" (no space
// at all between the digits and hand letters) - confirmed via a live
// capture (2026-08-21) that the source station's own delimiter isn't
// guaranteed for every runway/hand combination, so both gaps are \s*
// rather than \s+.
function parseRunway(raw: string): { runway: string | null; hand: string | null } {
  const match = raw.match(/RWY\s*(\d+)\s*([A-Z]+)/i)
  return match ? { runway: match[1], hand: match[2] } : { runway: null, hand: null }
}

// "1017.9hPa" -> { qnh_hpa: 1017.9 }
function parseQnh(raw: string): { qnh_hpa: number | null } {
  const match = raw.match(/([\d.]+)\s*hPa/i)
  return { qnh_hpa: match ? parseFloat(match[1]) : null }
}

// "1006.3hPa" -> { qfe_hpa: 1006.3 }
function parseQfe(raw: string): { qfe_hpa: number | null } {
  const match = raw.match(/([\d.]+)\s*hPa/i)
  return { qfe_hpa: match ? parseFloat(match[1]) : null }
}

// "300°/7kt" -> { wind_dir_deg: 300, wind_speed_kt: 7 }
function parseWind(raw: string): { wind_dir_deg: number | null; wind_speed_kt: number | null } {
  const match = raw.match(/(\d+)\s*°\s*\/\s*([\d.]+)\s*kt/i)
  return match
    ? { wind_dir_deg: parseInt(match[1], 10), wind_speed_kt: parseFloat(match[2]) }
    : { wind_dir_deg: null, wind_speed_kt: null }
}

// "7.8kt (10min avg.)" -> { wind_avg_kt: 7.8, wind_avg_period_min: 10 }
function parseAvgWind(raw: string): { wind_avg_kt: number | null; wind_avg_period_min: number | null } {
  const match = raw.match(/([\d.]+)\s*kt\s*\(\s*(\d+)\s*min/i)
  return match
    ? { wind_avg_kt: parseFloat(match[1]), wind_avg_period_min: parseInt(match[2], 10) }
    : { wind_avg_kt: null, wind_avg_period_min: null }
}

// "25.3°C/17.3°C" -> { temp_c: 25.3, dewpoint_c: 17.3 }
function parseTempDew(raw: string): { temp_c: number | null; dewpoint_c: number | null } {
  const match = raw.match(/(-?[\d.]+)\s*°C\s*\/\s*(-?[\d.]+)\s*°C/i)
  return match
    ? { temp_c: parseFloat(match[1]), dewpoint_c: parseFloat(match[2]) }
    : { temp_c: null, dewpoint_c: null }
}

// Time "11:46:26 UTC" + UTCDATE "07/07/26" (DD/MM/YY) -> "2026-07-07T11:46:26Z"
//
// HTMLRewriter's text() hands back the element's raw text content,
// including surrounding whitespace/newlines from the source HTML's own
// indentation (confirmed via a live capture: Time arrives as
// "\r\n    11:46:26 UTC    ", not "11:46:26 UTC") - trimmed here rather
// than in extractFieldsById(), since every other field's regex already
// tolerates that whitespace (none of them anchor with ^/$ the way these
// two do) and this keeps the fix scoped to the two lines actually
// broken by it.
function parseObservedAt(time: string, utcDate: string): { observed_at_utc: string | null } {
  const dateMatch = utcDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  const timeMatch = time.trim().match(/^(\d{2}):(\d{2}):(\d{2})/)
  if (!dateMatch || !timeMatch) return { observed_at_utc: null }

  const [, dd, mm, yy] = dateMatch
  const [, hh, min, ss] = timeMatch
  const year = 2000 + Number(yy)

  return { observed_at_utc: `${year}-${mm}-${dd}T${hh}:${min}:${ss}Z` }
}

// Empty string is a valid, expected state. Anything else is a real warning.
function parseWatchdog(raw: string): { watchdog_ok: boolean; watchdog_message: string | null } {
  const trimmed = raw.trim()
  return trimmed === '' ? { watchdog_ok: true, watchdog_message: null } : { watchdog_ok: false, watchdog_message: trimmed }
}

// Empty string -> no NOTAMs. Non-empty: the real delimiter is unconfirmed
// (never seen non-empty in a live capture yet), so store the whole string
// as a single-element array rather than guessing at a split character.
function parseNotams(raw: string): { notams: string[] } {
  const trimmed = raw.trim()
  return trimmed === '' ? { notams: [] } : { notams: [trimmed] }
}

async function parseWeatherHtml(html: string): Promise<{ parsed: Record<string, unknown>; raw_unparsed: Record<string, string> }> {
  const fields = await extractFieldsById(html)

  const parsed: Record<string, unknown> = {
    ...parseRunway(fields.RWY ?? ''),
    ...parseQnh(fields.QNH ?? ''),
    ...parseQfe(fields.QFE ?? ''),
    ...parseWind(fields.WIND ?? ''),
    ...parseAvgWind(fields.AVGWSPEED ?? ''),
    ...parseTempDew(fields.TEMPDEW ?? ''),
    ...parseObservedAt(fields.Time ?? '', fields.UTCDATE ?? ''),
    ...parseWatchdog(fields.WATCHDOG ?? ''),
    ...parseNotams(fields.NOTAMSBOX ?? ''),
    // Secondary debug field only - never the primary timestamp.
    local_time_debug: fields.LOCALTIME ?? null,
  }

  const raw_unparsed: Record<string, string> = {}
  for (const [id, text] of Object.entries(fields)) {
    if (!KNOWN_FIELD_IDS.includes(id)) {
      raw_unparsed[id] = text
    }
  }

  return { parsed, raw_unparsed }
}

// ── Active theme (shared across all devices via KV) ────────────────────
// Mirrors the DesignTokens key set in src/services/designTemplateStore.ts.
// Duplicated here rather than imported, since this worker is a separate
// deployable with no shared build/import path into the Vite app - keep
// both lists in sync if a token is ever added or removed.
const THEME_TOKEN_KEYS = [
  '--color-page-from', '--color-page-via', '--color-page-to',
  '--color-header-from', '--color-header-via', '--color-header-to',
  '--color-panel-bg', '--color-card-bg', '--color-border',
  '--color-text-primary', '--color-text-muted-300', '--color-text-muted-400', '--color-text-muted-500',
  '--color-accent-sky-400', '--color-accent-sky-500',
  '--color-status-good-arrow', '--color-status-warn-arrow', '--color-status-bad-arrow',
  '--color-status-good-text', '--color-status-warn-text', '--color-status-bad-text',
  '--color-compass-fill', '--color-compass-ring', '--color-compass-cardinal', '--color-compass-markers',
  '--color-compass-disc-bg',
]

function isValidThemeTokens(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object') return false
  return THEME_TOKEN_KEYS.every((key) => typeof (value as Record<string, unknown>)[key] === 'string')
}

async function handleSetTheme(request: Request, env: Env): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  if (!isValidThemeTokens(payload)) {
    return new Response('Invalid theme token shape', { status: 400, headers: CORS_HEADERS })
  }

  await env.CAPTURES.put('theme', JSON.stringify(payload))

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Returns the stored token set verbatim, or a 404 with a null body if no
// theme has ever been applied yet - the client's fallback for either case
// is simply to leave the page's committed :root defaults in place.
async function handleGetTheme(env: Env): Promise<Response> {
  const raw = await env.CAPTURES.get('theme')
  if (!raw) {
    return new Response(JSON.stringify(null), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  return new Response(raw, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Domain doesn't matter for tenant resolution here - unlike the public
// config routes, this endpoint resolves its tenant purely from the API
// key in the Authorization header (see functions/api/ingest/weather.ts's
// own comment), so any hostname routing to the same Cloudflare Pages
// deployment works. Using the primary custom domain since it's the one
// confirmed reachable from outside Cloudflare's own network (this Worker
// makes a real external fetch, not an internal one).
const INGEST_WEATHER_URL = 'https://airfieldcentral.com/api/ingest/weather'
// Read counterpart - see functions/api/ingest/capture-interval.ts's own
// comment for why this route exists (the capture script itself has no
// way to hold a developer's browser session, so it can't call
// /api/tenant/developer-settings directly; this Worker proxies the read
// using the one secret it already holds for writes).
//
// Deliberately shobdon.airfieldcentral.com, NOT the bare apex
// INGEST_WEATHER_URL above uses - confirmed directly (curl, bundle
// hash comparison) that the bare apex is currently served by a stale,
// out-of-date deployment that predates this route's existence, while
// shobdon.airfieldcentral.com (an exact-match Pages custom domain) is
// confirmed current. INGEST_WEATHER_URL still works via the apex only
// because /api/ingest/weather already existed in whatever old
// deployment serves it - a latent risk for that URL too, flagged
// separately, not fixed here (out of this round's scope; this file is
// already Shobdon-specific throughout, so hardcoding its own real
// subdomain here is consistent with everything else in it, not a new
// compromise).
const CAPTURE_INTERVAL_URL = 'https://shobdon.airfieldcentral.com/api/ingest/capture-interval'

// Physical plausibility bounds - on top of, not instead of, the type/
// presence check in forwardToIngest below. That check alone catches a
// watchdog-error/totally-missing capture, but does nothing for a scrape
// that returns numeric-but-garbage values (confirmed in practice: a
// broken ADISP page has produced qnh_hpa=59, physically impossible).
// Ceilings are deliberately generous for Shobdon's real conditions
// (inland Herefordshire, not an exposed coastal/high-altitude site) -
// wide enough to never reject genuine extreme-weather data, tight
// enough to catch obvious garbage. Duplicated in functions/api/ingest/
// weather.ts's own copy of this same gate - this Worker is deployed
// completely independently (see this file's own top comment), so
// there's no shared module either side could import from.
const WIND_DIR_MIN_DEG = 0
const WIND_DIR_MAX_DEG = 360
const WIND_SPEED_MIN_KT = 0
const WIND_SPEED_MAX_KT = 150
const QNH_MIN_HPA = 900
const QNH_MAX_HPA = 1050
const TEMP_MIN_C = -40
const TEMP_MAX_C = 50

function isPlausibleCapture(windSpeedKt: number, windDirDeg: number, qnhHpa: number, tempC: number): boolean {
  return (
    windDirDeg >= WIND_DIR_MIN_DEG &&
    windDirDeg <= WIND_DIR_MAX_DEG &&
    windSpeedKt >= WIND_SPEED_MIN_KT &&
    windSpeedKt <= WIND_SPEED_MAX_KT &&
    qnhHpa >= QNH_MIN_HPA &&
    qnhHpa <= QNH_MAX_HPA &&
    tempC >= TEMP_MIN_C &&
    tempC <= TEMP_MAX_C
  )
}

// Platform weather-fallback cron (see wrangler.toml's own [triggers]
// crons) - checked every FALLBACK_CRON_INTERVAL_MINUTES, matching
// WeatherContext.tsx's own FALLBACK_RECHECK_INTERVAL_SECONDS (5 min) so
// the server-side job and the one remaining client-side state machine
// (Shobdon's own 'atc'-provider dashboard, which reads the live KV
// capture directly, not D1 - see this function's own closing comment)
// operate on the same cadence instead of two independently-tuned
// numbers that could drift apart. STALE_THRESHOLD_MINUTES is 2x that
// interval - same "tolerate one missed run before treating it as a
// genuine outage, not just ordinary poll-timing jitter" reasoning
// atcProvider.ts's own 2x-cadence threshold already uses for its much
// tighter (~60s) per-poll check.
const FALLBACK_CRON_INTERVAL_MINUTES = 5
const STALE_THRESHOLD_MINUTES = FALLBACK_CRON_INTERVAL_MINUTES * 2

// Platform-level weather continuity guarantee - runs on a schedule,
// independent of any single tenant's own capture pipeline. For every
// tenant that OWNS a physical station (active_weather_provider = 'atc'
// - queried fresh on every run, never hardcoded, so this automatically
// covers every future airfield onboarded the same way Shobdon was, with
// zero additional wiring), checks whether its most recent GENUINE
// capture (weather_observations.source_type = 'atc_capture', NOT
// latest_conditions.last_updated_at - see the staleness-feedback-loop
// comment right above the query below for why that distinction is load-
// bearing) is still fresh. If not (that tenant's own PC2-equivalent has
// stopped sending - the same "capture stopped" condition
// atcProvider.ts's own per-poll staleness check already detects
// client-side, just checked here on a slower, platform-wide cadence
// instead of per-browser-tab), fetches a Met Office/SAWS reading for
// that tenant's own stored lat/lon (tenants.lat/lon) via
// fetchOpenMeteoWeather - imported, not reimplemented, see this file's
// own import comment - and writes it straight into
// weather_observations/latest_conditions for that SAME tenant, tagged
// source_type = 'met_office_fallback' (see that column's own comment in
// functions/api/ingest/weather.ts and types/weather.ts's
// sourceReadingType).
//
// Once this tenant's own data stream is continuous again (real capture
// OR this fallback), EVERY subtenant linked to it via parent_tenant_id
// inherits the fix for free - functions/api/public/weather-latest.ts's
// existing resolveEffectiveTenantById already reads whichever tenant is
// the effective source, with no subtenant-specific code anywhere. This
// is the whole point of moving the guarantee here instead of extending
// WeatherContext.tsx's own client-side 'atc' effect to also cover
// 'ingested' consumers (the shape explicitly rejected for this round) -
// one server-side job covers the station-owning tenant AND every one of
// its subtenants at once, for this tenant and every future one, rather
// than requiring every dashboard consumer to independently detect and
// react to the same staleness.
//
// Deliberately writes to D1 directly (env.DB, a system-level binding on
// THIS Worker) rather than POSTing through the authenticated
// /api/ingest/weather endpoint the way a real station relay does
// (forwardToIngest below, or PC2's own script, via SHOBDON_INGEST_KEY).
// That endpoint's per-tenant API key model is right for "one specific
// device authenticating as the one tenant it belongs to," but wrong
// here: this job legitimately needs to write on behalf of an arbitrary,
// dynamically-discovered set of tenants, and API keys are SHA-256
// hashed at rest with the raw value never recoverable after generation
// (apiKeys.ts's own comment) - minting and securely storing one more
// named secret per future station-owning tenant purely so this job
// could authenticate as each of them is exactly the kind of per-tenant
// wiring this whole round exists to eliminate.
//
// The INSERT/UPSERT shape below mirrors (does not import - separately
// deployed Worker, no shared build for runtime code, same reason
// WIND_DIR_MIN_DEG etc. above are already duplicated rather than
// imported) functions/api/ingest/weather.ts's own POST handler exactly,
// including deliberately leaving runway/runway_hand as NULL - Open-Meteo
// has no runway concept, and a NULL runway is what already makes that
// endpoint's own ops_panel_state sync block a no-op (its own
// `if (runway !== null)` guard) rather than this fallback data ever
// silently overwriting the ATC Control page's "official" runway-in-use
// state, which has its own separate SADDS automation flag and must stay
// untouched by this.
//
// NOT yet wired to Shobdon's own 'atc'-provider dashboard: that reads
// the live KV capture endpoint directly (fetchAtcWeather/LATEST_READING_URL),
// never weather_observations/D1, so this job keeping D1 fresh does not
// by itself help the station-owning tenant's OWN dashboard - it already
// has its own working client-side fallback (WeatherContext.tsx's
// 'atc'-only effect), untouched by this round. Unifying the
// station-owning tenant's own dashboard onto this same D1-backed path
// (so this one job becomes the ENTIRE platform's single continuity
// guarantee, full stop) is a real, larger follow-up worth doing
// deliberately, not a side effect of this change - see this round's own
// report.
async function runWeatherFallbackCheck(env: Env): Promise<void> {
  const { results: stationTenants } = await env.DB
    .prepare("SELECT id, lat, lon FROM tenants WHERE active_weather_provider = 'atc' AND active = 1 AND deleted_at IS NULL")
    .bind()
    .all<{ id: number; lat: number | null; lon: number | null }>()

  for (const tenant of stationTenants) {
    // No known location - nothing to fetch a fallback reading FOR. Not
    // logged as an error - a station-owning tenant with lat/lon unset
    // yet is a real, valid interim onboarding state, same posture
    // publicApi.ts's own null-coalescing fallbacks already take
    // elsewhere for an incompletely-configured tenant.
    if (typeof tenant.lat !== 'number' || typeof tenant.lon !== 'number') continue

    // Staleness-feedback-loop fix (code review round): this MUST read
    // the tenant's last GENUINE 'atc_capture' observation, never
    // latest_conditions.last_updated_at - the fallback's own upsert
    // below writes that exact column, so checking it would let the
    // fallback's own write make the row look "fresh" again and silence
    // itself for the next 1-2 cron ticks instead of re-checking (and
    // re-writing) every single tick a real station stays down, letting
    // displayed weather lag up to STALE_THRESHOLD_MINUTES behind actual
    // conditions instead of one cron interval. Scoping to source_type =
    // 'atc_capture' specifically (not just "any observation") is what
    // keeps the fallback job blind to its own prior writes - a self-
    // reinforcing "fresh because I made it fresh" loop is exactly the
    // bug this guards against.
    //
    // Confirmed efficient before writing this: idx_weather_tenant_time
    // (tenant_id, observed_at DESC) - migrations/0022_tenant_schema.sql -
    // already lets SQLite's planner do an index range scan keyed on
    // tenant_id, walking rows in observed_at DESC order (no separate
    // sort step) and applying the source_type filter per row as it
    // goes, stopping at the first match for LIMIT 1 - verified via
    // EXPLAIN QUERY PLAN against local D1
    // ("SEARCH weather_observations USING INDEX idx_weather_tenant_time
    // (tenant_id=?)"). Real captures run far more often (~60s cadence,
    // atcProvider.ts) than this 5-minute cron, so in practice this walks
    // at most a handful of rows before finding the latest real capture -
    // not a full-table or even full-per-tenant scan - so no new index
    // was needed.
    const latestCapture = await env.DB
      .prepare("SELECT observed_at AS observedAt FROM weather_observations WHERE tenant_id = ? AND source_type = 'atc_capture' ORDER BY observed_at DESC LIMIT 1")
      .bind(tenant.id)
      .first<{ observedAt: string }>()

    const lastCaptureMs = latestCapture?.observedAt ? Date.parse(latestCapture.observedAt) : NaN
    const isStale = Number.isNaN(lastCaptureMs) || Date.now() - lastCaptureMs > STALE_THRESHOLD_MINUTES * 60 * 1000
    if (!isStale) continue

    try {
      // Minimal WeatherConfig stub - fetchOpenMeteoWeather only ever
      // reads config.internet.latitude/longitude (confirmed against its
      // own source before reusing it here, not assumed); every other
      // field exists only to satisfy the shared type this call site
      // doesn't otherwise need, never actually read by this call.
      const stubConfig: WeatherConfig = {
        activeProvider: 'internet',
        atc: { stationUrl: '', refreshIntervalSeconds: 60, connectionTimeoutMs: 5000, autoReconnectEnabled: true },
        internet: { provider: 'open-meteo', latitude: tenant.lat, longitude: tenant.lon, refreshIntervalSeconds: 60 },
      }
      const { data } = await fetchOpenMeteoWeather(stubConfig)

      if (!isPlausibleCapture(data.windSpeed, data.windDirection, data.qnh, data.temperature)) {
        console.error('runWeatherFallbackCheck: rejecting implausible Open-Meteo reading', { tenantId: tenant.id, data })
        continue
      }

      const observedAt = new Date().toISOString()
      const insertResult = await env.DB
        .prepare(
          `INSERT INTO weather_observations
             (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, raw_snapshot_id, source_type, notams_json, runway, runway_hand)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          tenant.id,
          observedAt,
          data.windSpeed,
          data.windDirection,
          data.windGust ?? null,
          data.qnh,
          null,
          data.temperature,
          data.dewpoint ?? null,
          null,
          null,
          'met_office_fallback',
          JSON.stringify([]),
          null,
          null
        )
        .run()
      if (!insertResult.success) {
        console.error('runWeatherFallbackCheck: failed to insert fallback observation', { tenantId: tenant.id })
        continue
      }

      const inserted = await env.DB
        .prepare('SELECT id FROM weather_observations WHERE tenant_id = ? ORDER BY id DESC LIMIT 1')
        .bind(tenant.id)
        .first<{ id: number }>()

      await env.DB
        .prepare(
          `INSERT INTO latest_conditions (tenant_id, observation_id, last_updated_at, expected_interval_min, is_stale)
           VALUES (?, ?, ?, 10, 0)
           ON CONFLICT(tenant_id) DO UPDATE SET
             observation_id = excluded.observation_id,
             last_updated_at = excluded.last_updated_at,
             is_stale = 0`
        )
        .bind(tenant.id, inserted?.id ?? null, observedAt)
        .run()
    } catch (error) {
      console.error('runWeatherFallbackCheck: fallback fetch/write failed', {
        tenantId: tenant.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// Same bucket formula as migrations/0096_weather_snapshots_15min.sql and
// 0097_backfill_weather_snapshots_15min.sql use against a stored
// observed_at column - applied here to datetime('now') instead, so this
// cron and that one-time backfill can never silently disagree about what
// "the current 15-minute bucket" is for data straddling the cutover.
const CURRENT_BUCKET_SQL = "strftime('%Y-%m-%dT%H:', 'now') || printf('%02d', (CAST(strftime('%M', 'now') AS INTEGER) / 15) * 15) || ':00.000Z'"

// Weather capture retention round: runs every cron tick alongside (not
// instead of) runWeatherFallbackCheck above - see scheduled() below for
// how the two are isolated from each other. Three independent jobs in
// one pass, all tenant-scoped and all safe to re-run every 5 minutes:
//
// 1. Snapshot: for every station-owning tenant, if no
//    weather_snapshots_15min row exists yet for the CURRENT 15-minute
//    bucket, insert one sourced from that tenant's latest
//    weather_observations row. INSERT OR IGNORE + migration 0096's own
//    UNIQUE(tenant_id, observed_at) makes this idempotent across however
//    many ticks land inside the same bucket - no separate existence
//    check needed first.
// 2. Trim weather_observations to a rolling 24h (full-resolution capture
//    history only needs to cover "what happened very recently" - the
//    15-min snapshot table is what covers the long term from here on).
// 3. Trim weather_snapshots_15min to a rolling 12 months.
//
// Both trims are plain age-based DELETEs (observed_at cutoff), not
// per-tenant loops - a pure "how old is this row" condition applies
// uniformly across every tenant in a single statement.
async function runSnapshotAndTrimJob(env: Env): Promise<void> {
  const { results: stationTenants } = await env.DB
    .prepare("SELECT id FROM tenants WHERE active_weather_provider = 'atc' AND active = 1 AND deleted_at IS NULL")
    .bind()
    .all<{ id: number }>()

  for (const tenant of stationTenants) {
    try {
      await env.DB
        .prepare(
          `INSERT OR IGNORE INTO weather_snapshots_15min
             (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, runway, runway_hand, source_type)
           SELECT
             tenant_id, ${CURRENT_BUCKET_SQL}, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, runway, runway_hand, source_type
           FROM weather_observations
           WHERE tenant_id = ?
           ORDER BY observed_at DESC
           LIMIT 1`
        )
        .bind(tenant.id)
        .run()
    } catch (error) {
      console.error('runSnapshotAndTrimJob: snapshot insert failed', {
        tenantId: tenant.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    // latest_conditions.observation_id (migrations/0022_tenant_schema.sql)
    // FK-references weather_observations(id) - the exact same constraint
    // that blocked this retention round's own Step 1 stray-row cleanup
    // until the referencing row was nulled first (see that migration's
    // own investigation notes). Left alone, ANY tenant whose station
    // stops reporting for >24h (or a template/demo tenant sitting on a
    // single old row) would make this DELETE fail outright every single
    // tick - a plain DELETE is all-or-nothing, so one stale reference
    // anywhere would silently block the 24h trim forever, not just for
    // that one row. Nulling first (not deleting latest_conditions rows)
    // matches Step 1's own precedent: the column is nullable by design,
    // and a tenant briefly showing "no known latest reading" until its
    // next real capture arrives is the correct, harmless interim state.
    await env.DB
      .prepare(
        `UPDATE latest_conditions SET observation_id = NULL
         WHERE observation_id IN (SELECT id FROM weather_observations WHERE observed_at < datetime('now', '-24 hours'))`
      )
      .bind()
      .run()

    await env.DB
      .prepare("DELETE FROM weather_observations WHERE observed_at < datetime('now', '-24 hours')")
      .bind()
      .run()
  } catch (error) {
    console.error('runSnapshotAndTrimJob: 24h weather_observations trim failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    await env.DB
      .prepare("DELETE FROM weather_snapshots_15min WHERE observed_at < datetime('now', '-12 months')")
      .bind()
      .run()
  } catch (error) {
    console.error('runSnapshotAndTrimJob: 12mo weather_snapshots_15min trim failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Forwards this capture's already-parsed fields to the generic,
// genuinely multi-tenant D1 ingestion endpoint, ADDITIONALLY to (never
// instead of) the KV write below - built to let Shobdon migrate off
// this file's own single-tenant global KV keys (see the KNOWN FUTURE
// COLLISION comment below) without touching PC2's installed script at
// all: PC2 keeps POSTing the exact same raw HTML to this exact same
// Worker URL+key it always has, unaware this forward exists. Every
// error path here is deliberately swallowed - a broken or unreachable
// ingest endpoint must never affect what PC2 experiences, which is why
// this is only ever called via ctx.waitUntil(...caught...), never
// awaited inline in handlePost's own response path.
//
// wind_avg_kt is an averaging-period mean, not a gust reading (see
// parseAvgWind's own comment) - windGustKt is correctly omitted here,
// same as atcProvider.ts's own conclusion for the exact same station
// data, not an oversight.
async function forwardToIngest(parsed: Record<string, unknown>, capturedAt: string | null, env: Env): Promise<void> {
  if (!env.SHOBDON_INGEST_KEY) return

  const windSpeedKt = parsed.wind_speed_kt
  const windDirDeg = parsed.wind_dir_deg
  const qnhHpa = parsed.qnh_hpa
  const qfeHpa = parsed.qfe_hpa
  const tempC = parsed.temp_c
  // Required fields on the ingest endpoint's own side - a watchdog-error
  // or otherwise incomplete capture simply isn't forwarded this cycle,
  // same as it already doesn't update the dashboard-facing KV `latest`
  // in a fully-trustworthy way either (RightInfoPanel/atcProvider.ts
  // just show whatever this cycle produced).
  if (typeof windSpeedKt !== 'number' || typeof windDirDeg !== 'number' || typeof qnhHpa !== 'number' || typeof tempC !== 'number') {
    return
  }
  if (!isPlausibleCapture(windSpeedKt, windDirDeg, qnhHpa, tempC)) {
    console.error('forwardToIngest: rejecting implausible capture', { windSpeedKt, windDirDeg, qnhHpa, tempC })
    return
  }

  // observed_at_utc is frequently null (see atcProvider.ts's own comment -
  // the station's Time field's whitespace/multi-line quirk isn't fully
  // handled by parseObservedAt yet) - capturedAt (this script's own
  // fetch-time timestamp, always set) is the same fallback atcProvider.ts
  // itself relies on for staleness checks, reused here for the same
  // reason rather than skipping the forward whenever this one field is
  // unreliable.
  const observedAt = typeof parsed.observed_at_utc === 'string' ? parsed.observed_at_utc : (capturedAt ?? new Date().toISOString())

  const notams = Array.isArray(parsed.notams) && parsed.notams.every((n) => typeof n === 'string') ? parsed.notams : []

  const response = await fetch(INGEST_WEATHER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SHOBDON_INGEST_KEY}` },
    body: JSON.stringify({
      sourceType: 'atc_capture',
      observedAt,
      windSpeedKt,
      windDirDeg,
      qnhHpa,
      // QFE round: optional, same "don't fail the whole forward over one
      // supplementary field" posture as dewpointC below - parsed already
      // (parseQfe(), confirmed present in every real capture seen so
      // far), just never included in this specific forward call until
      // now.
      qfeHpa: typeof qfeHpa === 'number' ? qfeHpa : null,
      tempC,
      dewpointC: typeof parsed.dewpoint_c === 'number' ? parsed.dewpoint_c : null,
      notams,
      runway: typeof parsed.runway === "string" ? parsed.runway : null,
      runwayHand: typeof parsed.hand === "string" ? parsed.hand : null,
    }),
  })
  if (!response.ok) {
    // Logged via a KV write (cheap, already have a namespace bound) so a
    // string of failures is visible somewhere without needing Workers
    // Logs/Tail set up specifically for this - overwrites on every
    // failure, deliberately not a growing history (this is a "is the
    // bridge currently broken" signal, not an audit trail).
    await env.CAPTURES.put(
      'ingest-forward-last-error',
      JSON.stringify({ at: new Date().toISOString(), status: response.status, body: await response.text().catch(() => '') })
    ).catch(() => {})
  }
}

async function handlePost(request: Request, env: Env, ctx: MinimalExecutionContext): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  const body = payload as { html?: unknown; capturedAt?: unknown }
  let entry: CaptureEntry

  if (typeof body.html === 'string') {
    // New-style capture from capture-weathercentral.ps1: parse server-side,
    // keep the raw HTML alongside the parsed result rather than replacing it.
    const { parsed, raw_unparsed } = await parseWeatherHtml(body.html)
    const capturedAt = typeof body.capturedAt === 'string' ? body.capturedAt : null
    entry = {
      receivedAt: new Date().toISOString(),
      payload: {
        capturedAt,
        raw: body.html,
        parsed,
        raw_unparsed,
      },
    }
    // Fire-and-forget, deliberately not awaited here - see
    // forwardToIngest's own comment for why this can never affect what
    // PC2 experiences. ctx.waitUntil keeps it running after the response
    // below is returned, rather than risking it being cut off mid-flight.
    ctx.waitUntil(forwardToIngest(parsed, capturedAt, env).catch(() => {}))
  } else {
    // Existing browser-report shape (Capture & Copy button) - unchanged.
    entry = { receivedAt: new Date().toISOString(), payload }
  }

  // KNOWN FUTURE COLLISION (deliberately deferred, not fixed now): 'latest'
  // and 'history' are single global KV keys, not tenant-scoped. That's
  // fine while Shobdon is the only tenant, but the moment a second
  // airfield's PC2 starts POSTing here, both tenants' captures would
  // land in the same keys and overwrite/interleave. Fix when it's
  // actually needed: prefix these keys with the tenant slug (e.g.
  // 'latest:shobdon'), not before - this whole capture pipeline and its
  // ?key= convention are explicitly out of scope for the phase-0
  // multi-tenant auth work (D1 doesn't touch this file at all).
  const historyRaw = await env.CAPTURES.get('history')
  const history: CaptureEntry[] = historyRaw ? JSON.parse(historyRaw) : []
  history.unshift(entry)
  history.length = Math.min(history.length, MAX_HISTORY)

  await Promise.all([
    env.CAPTURES.put('latest', JSON.stringify(entry)),
    env.CAPTURES.put('history', JSON.stringify(history)),
  ])

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Clean JSON for the live dashboard - the same data already rendered as
// HTML on the human-facing "View Capture Logs" page (GET /), just as a
// small structured payload a browser fetch() can consume directly instead
// of scraping the log page. Returns 404 + null body if there's no capture
// yet, or if the latest one is an old-style browser-report capture with no
// `parsed` field (nothing this endpoint can offer the dashboard).
interface LatestReadingResponse {
  receivedAt: string
  capturedAt: string | null
  parsed: Record<string, unknown>
}

async function handleGetLatestReading(env: Env): Promise<Response> {
  const raw = await env.CAPTURES.get('latest')
  if (!raw) {
    return new Response(JSON.stringify(null), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const entry = JSON.parse(raw) as CaptureEntry
  const payload = entry.payload as { capturedAt?: unknown; parsed?: unknown } | null

  if (!payload || typeof payload !== 'object' || !payload.parsed || typeof payload.parsed !== 'object') {
    return new Response(JSON.stringify(null), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const response: LatestReadingResponse = {
    receivedAt: entry.receivedAt,
    capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : null,
    parsed: payload.parsed as Record<string, unknown>,
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Proxies functions/api/ingest/capture-interval.ts for the PC2 capture
// script's own live-reload polling (capture-weathercentral.ps1) - see
// that file's own comment for why this indirection exists (the script
// only ever holds this Worker's CAPTURE_KEY, checked by checkKey()
// before this function is ever reached, never the separate
// SHOBDON_INGEST_KEY used for the actual app-side call below).
//
// Always resolves to SOME number, never an error status or null -
// deliberately matches the "never crash the loop, fall back to
// whatever it was already using" posture the script itself also
// implements independently. If SHOBDON_INGEST_KEY isn't configured, the
// upstream call fails, or the response is malformed, this returns
// captureIntervalSeconds: null rather than propagating a failure -
// simpler for the script to handle (one shape to parse, "null means
// keep your current value") than distinguishing between an HTTP error
// and a successful-but-still-null read.
async function handleGetCaptureInterval(env: Env): Promise<Response> {
  if (!env.SHOBDON_INGEST_KEY) {
    return new Response(JSON.stringify({ captureIntervalSeconds: null }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const upstream = await fetch(CAPTURE_INTERVAL_URL, {
      headers: { Authorization: `Bearer ${env.SHOBDON_INGEST_KEY}` },
    })
    if (!upstream.ok) {
      return new Response(JSON.stringify({ captureIntervalSeconds: null }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    const data = (await upstream.json()) as { captureIntervalSeconds?: unknown }
    const captureIntervalSeconds = typeof data.captureIntervalSeconds === 'number' ? data.captureIntervalSeconds : null
    return new Response(JSON.stringify({ captureIntervalSeconds }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ captureIntervalSeconds: null }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
}

function renderEntry(entry: CaptureEntry): string {
  const payload = (entry.payload ?? {}) as { reportText?: unknown }
  const reportText = typeof payload.reportText === 'string' ? payload.reportText : JSON.stringify(entry.payload, null, 2)

  return `<section style="margin-bottom:2rem;">
  <div style="color:#94a3b8;font-size:0.8rem;margin-bottom:0.4rem;">Received: ${escapeHtml(entry.receivedAt)}</div>
  <pre style="white-space:pre-wrap;word-break:break-word;background:#0b1220;color:#e2e8f0;padding:1rem;border-radius:8px;border:1px solid #1e293b;">${escapeHtml(reportText)}</pre>
</section>`
}

function renderInvestigation(entry: InvestigationEntry): string {
  return `<div style="padding:0.5rem 0;border-bottom:1px solid #1e293b;font-size:0.9rem;">
  <span style="color:#94a3b8;font-size:0.8rem;">${escapeHtml(entry.loggedAt)}</span>
  &mdash; <strong>${escapeHtml(entry.check)}:</strong> ${escapeHtml(entry.label)}
</div>`
}

async function handleGet(env: Env): Promise<Response> {
  const [latestRaw, historyRaw, investigationsRaw] = await Promise.all([
    env.CAPTURES.get('latest'),
    env.CAPTURES.get('history'),
    env.CAPTURES.get('investigations'),
  ])
  const history: CaptureEntry[] = historyRaw ? JSON.parse(historyRaw) : []
  const investigations: InvestigationEntry[] = investigationsRaw ? JSON.parse(investigationsRaw) : []

  const latestEntry: CaptureEntry | null = latestRaw ? JSON.parse(latestRaw) : null
  const latestHtml = latestEntry ? renderEntry(latestEntry) : '<p style="color:#94a3b8;">No captures received yet.</p>'

  // History includes the latest entry at index 0 - skip it here so it isn't shown twice.
  const olderHtml = history.slice(1).map(renderEntry).join('\n')
  const investigationsHtml = investigations.map(renderInvestigation).join('\n')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Shobdon Central - Weather Captures</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600&display=swap" rel="stylesheet">
<style>
  /* Scoped to the two action buttons only - the rest of this page keeps
     its existing system-font styling untouched (Montserrat isn't this
     app's actual chrome font anywhere else - see PC2CaptureSetup.tsx's
     own buttons for the real brand precedent this mirrors: flat border,
     no fill, cyan accent-sky (#0ea5e9/#38bdf8) only on hover, no glow/
     shadow). */
  .action-btn {
    font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #03101a;
    color: #e2e8f0;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 0.5rem 1.1rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .action-btn:hover {
    border-color: #0ea5e9;
    color: #38bdf8;
  }
  @media print {
    .no-print { display: none !important; }
  }
</style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#03101a; color:#e2e8f0; padding:2rem; max-width:900px; margin:0 auto;">
  <h1 style="font-size:1.25rem;">Shobdon Central — Weather Captures</h1>
  <div class="no-print" style="display:flex; gap:0.75rem; margin:0.75rem 0 1.5rem;">
    <button id="copy-btn" class="action-btn" onclick="copyLogs()">Copy</button>
    <button class="action-btn" onclick="window.print()">Print</button>
  </div>
  <h2 style="font-size:1rem;color:#94a3b8;">Latest</h2>
  ${latestHtml}
  ${olderHtml ? `<h2 style="font-size:1rem;color:#94a3b8;">History</h2>${olderHtml}` : ''}
  ${investigationsHtml ? `<h2 style="font-size:1rem;color:#94a3b8;margin-top:2rem;">Station Investigations</h2>${investigationsHtml}` : ''}
  <script>
    // Copies the raw log data (every <pre> block's own text - the
    // actual capture JSON, not the section headings around it) as plain
    // text. No dependency - navigator.clipboard.writeText is a standard
    // browser API. Brief inline "Copied!" feedback rather than alert(),
    // so it doesn't interrupt/steal focus.
    async function copyLogs() {
      const blocks = Array.from(document.querySelectorAll('pre')).map((el) => el.textContent || '')
      const text = blocks.join('\\n\\n')
      const btn = document.getElementById('copy-btn')
      const original = btn.textContent
      try {
        await navigator.clipboard.writeText(text)
        btn.textContent = 'Copied!'
      } catch (err) {
        btn.textContent = 'Copy failed'
      }
      setTimeout(() => { btn.textContent = original }, 1500)
    }
  </script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: MinimalExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (!checkKey(request, env)) {
      return new Response('Unauthorized', { status: 403, headers: CORS_HEADERS })
    }

    const pathname = new URL(request.url).pathname

    if (pathname === '/refresh' && request.method === 'GET') {
      return handleSetRefreshFlag(request, env)
    }

    if (pathname === '/refresh-check' && request.method === 'GET') {
      return handleCheckRefreshFlag(request, env)
    }

    if (pathname === '/investigate' && request.method === 'POST') {
      return handleLogInvestigation(request, env)
    }

    if (pathname === '/theme' && request.method === 'POST') {
      return handleSetTheme(request, env)
    }

    if (pathname === '/theme' && request.method === 'GET') {
      return handleGetTheme(env)
    }

    if (pathname === '/latest' && request.method === 'GET') {
      return handleGetLatestReading(env)
    }

    if (pathname === '/capture-interval' && request.method === 'GET') {
      return handleGetCaptureInterval(env)
    }

    if (request.method === 'POST') return handlePost(request, env, ctx)
    if (request.method === 'GET') return handleGet(env)

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  },

  // Platform weather-fallback cron round. Fires on wrangler.worker.toml's
  // [triggers] crons schedule (every FALLBACK_CRON_INTERVAL_MINUTES) -
  // see runWeatherFallbackCheck's own comment for the full design. Same
  // waitUntil(...catch(() => {})) shape handlePost already uses for
  // forwardToIngest: one bad tenant/fetch must never surface as an
  // uncaught exception that Cloudflare would otherwise log as a failed
  // cron invocation, since runWeatherFallbackCheck already isolates and
  // logs per-tenant failures internally.
  async scheduled(_event: MinimalScheduledEvent, env: Env, ctx: MinimalExecutionContext): Promise<void> {
    ctx.waitUntil(runWeatherFallbackCheck(env).catch((error) => console.error('runWeatherFallbackCheck failed', error)))
    ctx.waitUntil(runSnapshotAndTrimJob(env).catch((error) => console.error('runSnapshotAndTrimJob failed', error)))
  },
}
