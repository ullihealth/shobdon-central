import { useState } from 'react'
import { testAtcConnection } from '../../services/atcDiagnostics'
import type { AtcConnectionTestResult } from '../../services/atcDiagnostics'

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
function buildCaptureReport(stationUrl: string, result: AtcConnectionTestResult): string {
  const rawSection = result.ok ? (result.rawText ?? '') : `ERROR: ${result.errorMessage ?? 'Unknown error'}`

  return [
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
  ].join('\n')
}

export default function AtcDeveloperTools({ stationUrl, connectionTimeoutMs }: AtcDeveloperToolsProps): JSX.Element {
  const [status, setStatus] = useState<CaptureStatus>('idle')

  async function handleCapture() {
    setStatus('working')
    const result = await testAtcConnection(stationUrl, connectionTimeoutMs)
    const report = buildCaptureReport(stationUrl, result)
    await navigator.clipboard.writeText(report)
    setStatus('done')
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Developer Tools</div>
      <p className="mb-6 text-sm text-slate-400">
        Press the button, walk away from the ATC PC, then paste the clipboard into an LLM back at your Mac.
      </p>

      <button
        type="button"
        onClick={handleCapture}
        disabled={status === 'working'}
        className="w-full rounded-lg bg-sky-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === 'working' ? 'Capturing…' : '📋 CAPTURE & COPY WEATHER SNAPSHOT'}
      </button>

      {status === 'done' && (
        <p className="mt-4 text-sm font-semibold text-green-400">✅ Weather snapshot copied to clipboard.</p>
      )}
    </div>
  )
}
