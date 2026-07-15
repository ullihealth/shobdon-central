import { useState } from 'react'

// Static files under public/downloads/ - served directly by Cloudflare
// Pages as plain assets, no Function/Blob trick needed. Single source of
// truth for their contents is the files themselves, not a duplicated
// string in this bundle.
const CAPTURE_SCRIPT_URL = '/downloads/capture-weathercentral.ps1'
const INSTALLER_URL = '/downloads/install-weather-capture-autostart.bat'
const SETUP_PDF_URL = '/downloads/Shobdon-Central-Weather-Feed-Setup.pdf'

// Same-origin, authenticated routes (functions/api/tenant/capture-logs.ts
// and capture-refresh.ts) - replace the old direct links to
// https://shobdon-central-capture.<subdomain>.workers.dev/?key=<CAPTURE_KEY>,
// which put the raw key in a copy-pasteable/screenshottable URL. These
// routes check the logged-in admin's session and inject the key
// server-side, so it never reaches the browser.
const CAPTURE_LOGS_ROUTE = '/api/tenant/capture-logs'
const CAPTURE_REFRESH_ROUTE = '/api/tenant/capture-refresh'

type RefreshStatus = 'idle' | 'pending' | 'success' | 'error'

// Self-serve setup for a new site's ATC PC2 - previously required the
// developer to manually send files and talk someone through it live over
// a call. Any owner/admin can now do this themselves from /config: download
// both files, run the installer once, confirm via the logs link.
export default function PC2CaptureSetup(): JSX.Element {
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle')

  async function handleRefreshTrigger() {
    if (!window.confirm('Trigger a remote refresh on PC2?')) return

    setRefreshStatus('pending')
    try {
      const response = await fetch(CAPTURE_REFRESH_ROUTE)
      setRefreshStatus(response.ok ? 'success' : 'error')
    } catch {
      setRefreshStatus('error')
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-400">
        PC2 / Weather Capture Setup
      </h3>
      <p className="mb-4 text-sm text-muted-300">
        Everything a new site needs to get its ATC PC (&quot;PC2&quot;) sending live weather data - no developer
        involvement required.
      </p>

      <div className="mb-5 flex flex-wrap gap-3">
        <a
          href={CAPTURE_SCRIPT_URL}
          download
          className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          ⬇ Download capture script
        </a>
        <a
          href={INSTALLER_URL}
          download
          className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          ⬇ Download auto-start installer
        </a>
        <a
          href={SETUP_PDF_URL}
          download
          className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          ⬇ Download setup instructions (PDF)
        </a>
        <a
          href={CAPTURE_LOGS_ROUTE}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          ↗ View Capture Logs
        </a>
        <button
          type="button"
          onClick={handleRefreshTrigger}
          className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
        >
          🔄 Refresh PC2 Now
        </button>
      </div>

      {refreshStatus === 'success' && (
        <p className="mb-4 text-sm font-semibold text-status-good">✅ Refresh requested.</p>
      )}
      {refreshStatus === 'error' && (
        <p className="mb-4 text-sm font-semibold text-status-bad">
          ❌ Could not reach the refresh trigger — check connectivity and try again.
        </p>
      )}

      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-300">
        <li>Download both files above into the same folder on PC2.</li>
        <li>
          Double-click <span className="font-mono text-primary">install-weather-capture-autostart.bat</span> once -
          it sets the capture script to run automatically at every login and starts it immediately.
        </li>
        <li>
          Click <span className="font-semibold text-primary">View Capture Logs</span> above and confirm a new entry
          appears within a minute.
        </li>
      </ol>
    </div>
  )
}
