import React, { useState, useRef } from 'react'

const TARGET_URL = 'http://192.168.2.1/disp/adisp.php'

type FetchResult = {
  ok: boolean
  status?: number
  headers?: Record<string, string>
  length?: number
  timeMs?: number
  body?: string
}

export default function App(): JSX.Element {
  const [statusText, setStatusText] = useState('Not Tested')
  const [rawResponse, setRawResponse] = useState<string | null>(null)
  const [errors, setErrors] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const logsRef = useRef<string[]>([])

  function log(...args: any[]) {
    console.log(...args)
    logsRef.current.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }

  async function doFetchPlain(url: string, opts: RequestInit = {}) {
    const started = performance.now()
    const resp = await fetch(url, opts)
    const timeMs = Math.round(performance.now() - started)
    return { resp, timeMs }
  }

  const WATCHDOG_MS = 30000 // does not abort fetch; only updates UI if fetch never resolves

  function headersToObject(headers: Headers) {
    const out: Record<string, string> = {}
    headers.forEach((v, k) => (out[k] = v))
    return out
  }

  function updateSummaryFromResult(result?: FetchResult, err?: any, noCorsReachable?: boolean) {
    if (result && result.ok) {
      setSummary('🟢 SUCCESS')
      return
    }
    if (!result && noCorsReachable) {
      setSummary('🟠 POSSIBLE CORS RESTRICTION')
      return
    }
    setSummary('🔴 NETWORK FAILURE')
  }

  async function runTest() {
    setStatusText('Testing...')
    setRawResponse(null)
    setErrors(null)
    setSummary('')

    log('Request Started', { url: TARGET_URL })
    const start = performance.now()

    let fetchResult: FetchResult | undefined
    let caughtError: any = null
    let noCorsReachable = false
    let timedOut = false
    let finished = false

    const wd = setTimeout(() => {
      if (!finished) {
        timedOut = true
        finished = true
        const msg = `Request did not complete within ${WATCHDOG_MS}ms. The browser fetch remains active; this marker is for diagnostics.`
        log('Watchdog timeout', { ms: WATCHDOG_MS })
        setErrors((prev) => (prev ? `${prev}\n\n${msg}` : msg))
        setSummary('🔴 NETWORK FAILURE')
        setStatusText(`Timeout after ${Math.round(WATCHDOG_MS / 1000)}s`)
      }
    }, WATCHDOG_MS)

    try {
      const { resp, timeMs } = await doFetchPlain(TARGET_URL)
      log('Request Completed', { status: resp.status, timeMs })
      const body = await resp.text()
      const headers = headersToObject(resp.headers)
      const length = body.length
      fetchResult = {
        ok: resp.ok,
        status: resp.status,
        headers,
        length,
        timeMs,
        body
      }

      if (!finished) {
        finished = true
        clearTimeout(wd)
        setStatusText(`${resp.status} ${resp.statusText || ''}`)
        setRawResponse(body)
      } else {
        log('Fetch completed after watchdog fired; not overwriting UI')
        setErrors((prev) => (prev ? `${prev}\n\nFetch completed after watchdog fired.` : 'Fetch completed after watchdog fired.'))
      }
    } catch (err: any) {
      caughtError = err
      log('Fetch error', err)
      if (!finished) {
        finished = true
        clearTimeout(wd)
        try {
          const structured: any = {}
          if (err && typeof err === 'object') {
            structured.name = (err as any).name
            structured.message = (err as any).message
            structured.stack = (err as any).stack
            Object.keys(err).forEach((k) => (structured[k] = (err as any)[k]))
          }
          const structuredText = JSON.stringify(structured, null, 2)
          setErrors(`${String(err)}\n\n${structuredText}`)
        } catch (serErr) {
          setErrors(String(err))
        }
      } else {
        setErrors((prev) => (prev ? `${prev}\n\nError after watchdog:\n${String(err)}` : `Error after watchdog:\n${String(err)}`))
      }
    }

    // If initial attempt failed, attempt a diagnostic no-cors probe to see if server is reachable.
    if (!fetchResult && !timedOut) {
      try {
        log('Attempting diagnostic no-cors probe')
        const { resp, timeMs } = await doFetchPlain(TARGET_URL, { mode: 'no-cors' })
        log('no-cors probe result', { type: (resp as any).type, timeMs })
        noCorsReachable = true
      } catch (probeErr) {
        log('no-cors probe failed', probeErr)
        noCorsReachable = false
      }
    }

    updateSummaryFromResult(fetchResult, caughtError, noCorsReachable)

    // Append fetch metadata for diagnostics
    if (fetchResult) {
      setErrors((e) => (e ? `${e}\n\n---\nFetch details:\n${JSON.stringify(fetchResult, null, 2)}` : JSON.stringify(fetchResult, null, 2)))
    } else if (caughtError) {
      setErrors((prev) => (prev ? `${prev}\n\nFull error:\n${String(caughtError && (caughtError.stack || caughtError.message || caughtError))}` : `Full error:\n${String(caughtError && (caughtError.stack || caughtError.message || caughtError))}`))
    }

    // Ensure status is never left as `Testing...`
    setTimeout(() => {
      setStatusText((s) => (s === 'Testing...' ? (timedOut ? `Timeout after ${Math.round(WATCHDOG_MS / 1000)}s` : 'Completed') : s))
    }, 0)

    const totalTime = Math.round(performance.now() - start)
    log('Request Finished', { totalTime })
  }

  return (
    <div className="min-h-screen bg-gray-900 text-slate-100 p-6 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Shobdon Central</h1>
          <p className="text-slate-400">Weather Connectivity Test</p>
        </header>

        <main className="space-y-6">
          <section className="bg-gray-800 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Status</div>
                <div className="text-xl font-medium">{statusText}</div>
              </div>
              <button
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm"
                onClick={runTest}
              >
                Test Direct Connection
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800 p-3 rounded-lg">
              <div className="text-sm text-slate-400 mb-2">Raw Response</div>
              <pre className="text-xs h-48 overflow-auto whitespace-pre-wrap">{rawResponse ?? '—'}</pre>
            </div>
            <div className="bg-gray-800 p-3 rounded-lg">
              <div className="text-sm text-slate-400 mb-2">Errors</div>
              <pre className="text-xs h-48 overflow-auto whitespace-pre-wrap">{errors ?? '—'}</pre>
            </div>
          </section>

          <section className="bg-gray-800 p-3 rounded-lg">
            <div className="text-sm text-slate-400 mb-2">Connection Summary</div>
            <div className="text-lg font-semibold">{summary || 'Not Tested'}</div>
          </section>

          <section className="bg-gray-800 p-3 rounded-lg opacity-60 pointer-events-none">
            <div className="text-sm text-slate-400 mb-2">Bridge Integration</div>
            <div>Coming in Phase 2</div>
          </section>
        </main>
      </div>
    </div>
  )
}
