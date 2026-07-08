import { useState } from 'react'
import { CAPTURE_LOG_URL, REFRESH_TRIGGER_URL } from '../../config/captureEndpoint'
import { CAPTURE_SCRIPT_CONTENTS, CAPTURE_SCRIPT_FILENAME } from '../../config/captureScript'
import InvestigateStation from './InvestigateStation'

function handleDownloadCaptureScript() {
  const blob = new Blob([CAPTURE_SCRIPT_CONTENTS], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = CAPTURE_SCRIPT_FILENAME
  link.click()
  URL.revokeObjectURL(url)
}

type RefreshTriggerStatus = 'idle' | 'success' | 'error'

export default function AtcDeveloperTools(): JSX.Element {
  const [refreshTriggerStatus, setRefreshTriggerStatus] = useState<RefreshTriggerStatus>('idle')

  async function handleRefreshTrigger() {
    if (!window.confirm('Trigger a remote refresh on PC2?')) return

    try {
      const response = await fetch(REFRESH_TRIGGER_URL)
      setRefreshTriggerStatus(response.ok ? 'success' : 'error')
    } catch {
      setRefreshTriggerStatus('error')
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-dashed border-amber-700/50 bg-amber-950/10 p-8">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-amber-500">Developer Tools</div>
      <p className="mb-4 text-sm text-slate-400">
        On ATC PC2, download and run <span className="font-mono text-slate-300">{CAPTURE_SCRIPT_FILENAME}</span> —
        it fetches the station directly and sends the result here automatically every 60 seconds, no browser
        involved. Leave the window open (minimizing is fine); closing it stops the data feed.
      </p>

      <div className="mb-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDownloadCaptureScript}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
        >
          ⬇ Download {CAPTURE_SCRIPT_FILENAME}
        </button>
        <a
          href={CAPTURE_LOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
        >
          ↗ View Capture Logs
        </a>
        <button
          type="button"
          onClick={handleRefreshTrigger}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-sky-500 hover:text-white"
        >
          🔄 Refresh PC2 Now
        </button>
      </div>

      <details className="mb-6">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300">
          Preview {CAPTURE_SCRIPT_FILENAME}
        </summary>
        <pre className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200">
          {CAPTURE_SCRIPT_CONTENTS}
        </pre>
      </details>

      {refreshTriggerStatus === 'success' && (
        <p className="mb-4 text-sm font-semibold text-green-400">✅ Refresh requested.</p>
      )}
      {refreshTriggerStatus === 'error' && (
        <p className="mb-4 text-sm font-semibold text-red-400">
          ❌ Could not reach the refresh trigger — check connectivity and try again.
        </p>
      )}

      <InvestigateStation />
    </div>
  )
}
