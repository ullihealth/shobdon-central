import { useEffect, useRef } from 'react'
import { REFRESH_CHECK_URL } from '../config/captureEndpoint'
import { isCaptureInProgress } from '../services/captureActivity'

// Lets a remote trigger (opened from a phone via the Worker's /refresh URL)
// force this tab to reload - so a fix pushed from home can be picked up on
// ATC PC2 without touching its keyboard/mouse. Polls a single-shot flag on
// the same Worker already used for capture logging.
//
// The Worker clears the flag the instant it's read, regardless of what we do
// with it - so `pendingReload` here is the client's own memory of "a reload
// was requested", kept across polls until it's actually safe to act on it.
// Never interrupts an in-progress capture: that's the one constraint that
// matters more than anything else about this feature.
const POLL_INTERVAL_MS = 12_000

export default function RemoteRefreshWatcher(): null {
  const pendingReload = useRef(false)

  useEffect(() => {
    async function poll() {
      try {
        if (!pendingReload.current) {
          const response = await fetch(REFRESH_CHECK_URL)
          if (response.ok) {
            const data: { refreshRequested?: boolean } = await response.json()
            if (data.refreshRequested) {
              pendingReload.current = true
            }
          }
        }
      } catch {
        // No connectivity to the check endpoint right now - try again next poll.
      }

      if (pendingReload.current && !isCaptureInProgress()) {
        window.location.reload()
      }
    }

    void poll()
    const interval = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  return null
}
