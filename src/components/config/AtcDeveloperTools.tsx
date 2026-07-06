import { useRef, useState } from 'react'
import { testAtcConnection } from '../../services/atcDiagnostics'
import type { AtcConnectionTestResult } from '../../services/atcDiagnostics'
import { CAPTURE_LOG_URL } from '../../config/captureEndpoint'
import { setCaptureInProgress } from '../../services/captureActivity'

interface AtcDeveloperToolsProps {
  stationUrl: string
  connectionTimeoutMs: number
}

type CaptureStatus = 'idle' | 'working' | 'done'

const REPORT_DIVIDER = '========================================='
const SECTION_DIVIDER = '-----------------------------------------'

function formatReportTimestamp(date: Date): string {
  const datePart = date.toLocaleDateString('en-CA')
  const timePart = date.toLocaleTimeString('en-GB', { hour12: false })
  const timeZoneName = new Intl.DateTimeFormat('en-GB', { timeZoneName: 'short' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  return timeZoneName ? `${datePart} ${timePart} ${timeZoneName}` : `${datePart} ${timePart}`
}

/**
 * The ATC PC only gets ~5 minutes of access to the WeatherLink station, so
 * this builds one plain-text engineering report - success or failure - for
 * pasting into an LLM back at a machine that can't reach 192.168.2.1.
 */
const MIXED_CONTENT_NOTE =
  'This app is served over HTTPS but the station URL is plain HTTP. Browsers block this request ' +
  '("mixed content") by default regardless of network reachability or CORS - a failure here may ' +
  'mean the station was never actually contacted.'

function isLoopbackHost(stationUrl: string): boolean {
  try {
    const hostname = new URL(stationUrl).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function buildCaptureReport(stationUrl: string, result: AtcConnectionTestResult): string {
  const rawSection = result.ok ? (result.rawText ?? '') : `ERROR: ${result.errorMessage ?? 'Unknown error'}`
  const targetsLoopback = isLoopbackHost(stationUrl)

  const likelyLnaDenied =
    !result.ok && targetsLoopback && result.localNetworkAccessState !== 'granted' && result.localNetworkAccessState !== 'unsupported'

  const likelyMixedContent =
    !result.ok && result.pageProtocol === 'https:' && stationUrl.startsWith('http://') && !targetsLoopback

  const lines = [
    REPORT_DIVIDER,
    'SHOBDON CENTRAL WEATHER CAPTURE',
    REPORT_DIVIDER,
    '',
    'Timestamp:',
    formatReportTimestamp(result.retrievedAt),
    '',
    'Station:',
    stationUrl,
    '',
    'Page Protocol:',
    result.pageProtocol,
    '',
    'Browser:',
    result.userAgent,
    '',
    'HTTP Status:',
    result.status !== null ? String(result.status) : '—',
    '',
    'Response Time:',
    `${result.responseTimeMs} ms`,
    '',
    'Content-Type:',
    result.contentType ?? '—',
    '',
    'Character Encoding:',
    result.characterEncoding ?? '—',
    '',
    'Response Size:',
    result.responseSizeBytes !== null ? `${result.responseSizeBytes} bytes` : '—',
  ]

  if (likelyLnaDenied) {
    lines.push(
      '',
      'Note:',
      `Local Network Access permission is not granted for this page (state: ${result.localNetworkAccessState}). ` +
        'Chrome should show a one-time prompt asking to allow access to your local network - click Allow, then press Capture again.'
    )
  } else if (likelyMixedContent) {
    lines.push('', 'Note:', MIXED_CONTENT_NOTE)
  }

  lines.push(
    '',
    SECTION_DIVIDER,
    'RAW RESPONSE',
    SECTION_DIVIDER,
    '',
    rawSection,
    '',
    REPORT_DIVIDER,
    'END OF CAPTURE',
    REPORT_DIVIDER,
  )

  return lines.join('\n')
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Best-effort remote log so a capture can be viewed from another device later.
// Deliberately not awaited by callers and never throws - must never delay or
// break the existing clipboard/display behaviour if it fails.
function logCaptureRemotely(stationUrl: string, result: AtcConnectionTestResult, reportText: string): void {
  fetch(CAPTURE_LOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stationUrl, result, reportText }),
  }).catch(() => {
    // No connectivity to the log endpoint at this instant - ignored on purpose.
  })
}

export default function AtcDeveloperTools({ stationUrl, connectionTimeoutMs }: AtcDeveloperToolsProps): JSX.Element {
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [report, setReport] = useState<string | null>(null)
  const [clipboardOk, setClipboardOk] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleCapture() {
    setStatus('working')
    setCaptureInProgress(true)
    try {
      const result = await testAtcConnection(stationUrl, connectionTimeoutMs)
      const nextReport = buildCaptureReport(stationUrl, result)
      setReport(nextReport)
      logCaptureRemotely(stationUrl, result, nextReport)
      setClipboardOk(await copyToClipboard(nextReport))
      setStatus('done')
    } finally {
      setCaptureInProgress(false)
    }
  }

  async function handleManualCopy() {
    if (!report) return
    setClipboardOk(await copyToClipboard(report))
    textareaRef.current?.select()
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Developer Tools</div>
      <p className="mb-4 text-sm text-slate-400">
        On ATC PC2: download the two relay files below (once), run start-relay.bat, then press Capture. The
        result is copied to the clipboard, shown below, and logged automatically so it's viewable from home
        afterward.
      </p>

      <div className="mb-6 flex flex-wrap gap-3">
        <a
          href="/downloads/relay.ps1"
          download="relay.ps1"
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
        >
          ⬇ Download relay.ps1
        </a>
        <a
          href="/downloads/start-relay.bat"
          download="start-relay.bat"
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
        >
          ⬇ Download start-relay.bat
        </a>
        <a
          href={CAPTURE_LOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
        >
          ↗ View Capture Logs
        </a>
      </div>

      <button
        type="button"
        onClick={handleCapture}
        disabled={status === 'working'}
        className="w-full rounded-lg bg-sky-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'working' ? 'Capturing…' : '📋 CAPTURE & COPY WEATHER SNAPSHOT'}
      </button>

      {status === 'done' && report && (
        <div className="mt-4">
          {clipboardOk ? (
            <p className="text-sm font-semibold text-green-400">✅ Weather snapshot copied to clipboard.</p>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-amber-400">
                ⚠️ Could not copy automatically — select the text below or press Copy.
              </p>
              <button
                type="button"
                onClick={handleManualCopy}
                className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
              >
                Copy
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            readOnly
            value={report}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-3 h-64 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200"
          />
        </div>
      )}
    </div>
  )
}
