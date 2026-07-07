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
function parseObservedAt(time: string, utcDate: string): { observed_at_utc: string | null } {
  const dateMatch = utcDate.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  const timeMatch = time.match(/^(\d{2}):(\d{2}):(\d{2})/)
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

async function handlePost(request: Request, env: Env): Promise<Response> {
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
    entry = {
      receivedAt: new Date().toISOString(),
      payload: {
        capturedAt: typeof body.capturedAt === 'string' ? body.capturedAt : null,
        raw: body.html,
        parsed,
        raw_unparsed,
      },
    }
  } else {
    // Existing browser-report shape (Capture & Copy button) - unchanged.
    entry = { receivedAt: new Date().toISOString(), payload }
  }

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
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (request.method === 'POST') return handlePost(request, env)
    if (request.method === 'GET') return handleGet(env)

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  },
}
