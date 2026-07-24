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

// Remote-refresh trigger: a single-shot flag in the same KV namespace, gated
// by the same shared key. GET /refresh sets it (so opening the URL on a
// phone is enough - no button/JS required); GET /refresh-check is polled by
// the app and clears the flag the moment it's read, whether or not the app
// actually reloads that cycle. This keeps the worker itself simple - the
// "don't interrupt an in-progress capture" logic lives entirely client-side.
const REFRESH_FLAG_KEY = 'refresh-requested'

async function handleSetRefreshFlag(env: Env): Promise<Response> {
  await env.CAPTURES.put(REFRESH_FLAG_KEY, new Date().toISOString())

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
  <p style="color:#94a3b8;">PC2 will pick this up within about 15 seconds - immediately if it's idle, or right after
  the current capture finishes if one is running.</p>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
  })
}

async function handleCheckRefreshFlag(env: Env): Promise<Response> {
  const flag = await env.CAPTURES.get(REFRESH_FLAG_KEY)
  if (flag) {
    await env.CAPTURES.delete(REFRESH_FLAG_KEY)
  }

  return new Response(JSON.stringify({ refreshRequested: !!flag }), {
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

// "RWY 26 LH" -> { runway: "26", hand: "LH" }
function parseRunway(raw: string): { runway: string | null; hand: string | null } {
  const match = raw.match(/RWY\s+(\d+)\s+([A-Z]+)/i)
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
  const tempC = parsed.temp_c
  // Required fields on the ingest endpoint's own side - a watchdog-error
  // or otherwise incomplete capture simply isn't forwarded this cycle,
  // same as it already doesn't update the dashboard-facing KV `latest`
  // in a fully-trustworthy way either (RightInfoPanel/atcProvider.ts
  // just show whatever this cycle produced).
  if (typeof windSpeedKt !== 'number' || typeof windDirDeg !== 'number' || typeof qnhHpa !== 'number' || typeof tempC !== 'number') {
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
      tempC,
      dewpointC: typeof parsed.dewpoint_c === 'number' ? parsed.dewpoint_c : null,
      notams,
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
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#03101a; color:#e2e8f0; padding:2rem; max-width:900px; margin:0 auto;">
  <h1 style="font-size:1.25rem;">Shobdon Central — Weather Captures</h1>
  <h2 style="font-size:1rem;color:#94a3b8;">Latest</h2>
  ${latestHtml}
  ${olderHtml ? `<h2 style="font-size:1rem;color:#94a3b8;">History</h2>${olderHtml}` : ''}
  ${investigationsHtml ? `<h2 style="font-size:1rem;color:#94a3b8;margin-top:2rem;">Station Investigations</h2>${investigationsHtml}` : ''}
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
      return handleSetRefreshFlag(env)
    }

    if (pathname === '/refresh-check' && request.method === 'GET') {
      return handleCheckRefreshFlag(env)
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

    if (request.method === 'POST') return handlePost(request, env, ctx)
    if (request.method === 'GET') return handleGet(env)

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  },
}
