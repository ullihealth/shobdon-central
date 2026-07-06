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

async function handlePost(request: Request, env: Env): Promise<Response> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  const entry: CaptureEntry = { receivedAt: new Date().toISOString(), payload }

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

    if (request.method === 'POST') return handlePost(request, env)
    if (request.method === 'GET') return handleGet(env)

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
  },
}
