// Remote capture log (Cloudflare Worker + KV) - lets a capture run on ATC PC2
// be viewed from any browser afterward. See worker/ at the project root.
//
// The key is a shared secret, not a security boundary: this is a static SPA,
// so anything sent from the browser is necessarily visible in the deployed
// bundle. It only needs to keep the log off search engines, not withstand
// anyone who reads this file.
const CAPTURE_WORKER_BASE = 'https://shobdon-central-capture.jeffthompson.workers.dev'
const CAPTURE_KEY = '49f761797d8e1fe76898e079b997980f'

export const CAPTURE_LOG_URL = `${CAPTURE_WORKER_BASE}/?key=${CAPTURE_KEY}`

// Polled by RemoteRefreshWatcher to check for a remote refresh trigger.
export const REFRESH_CHECK_URL = `${CAPTURE_WORKER_BASE}/refresh-check?key=${CAPTURE_KEY}`

// Called by the "Refresh PC2 Now" button to set the flag RemoteRefreshWatcher polls for.
export const REFRESH_TRIGGER_URL = `${CAPTURE_WORKER_BASE}/refresh?key=${CAPTURE_KEY}`

// Called by InvestigateStation's preset outcome buttons to log a one-tap result.
export const INVESTIGATION_LOG_URL = `${CAPTURE_WORKER_BASE}/investigate?key=${CAPTURE_KEY}`
