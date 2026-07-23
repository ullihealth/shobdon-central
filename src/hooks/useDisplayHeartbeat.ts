import { useEffect } from 'react'

// 3 minutes - within the 2-5 minute range this round's investigation
// settled on. The server-side dedup (functions/api/public/heartbeat.ts)
// is what actually controls how much gets logged/written - this
// interval just controls how often the client asks, not how often a
// row gets written.
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000

// Shared by DashboardPage.tsx ('/', slug 'main') and TenantDisplayPage.tsx
// ('/d/:slug') - pings the heartbeat endpoint on mount and every few
// minutes for as long as the display page stays open, so display_visits
// can answer "was this screen showing at 9am"/"what IPs have hit this"
// (see this round's own investigation for why a single last-seen
// timestamp couldn't answer either question). Silently ignores
// failures - a dropped heartbeat ping must never affect what's
// rendered on the actual screen; it's purely an out-of-band signal.
export function useDisplayHeartbeat(slug: string): void {
  useEffect(() => {
    function ping() {
      fetch(`/api/public/heartbeat?slug=${encodeURIComponent(slug)}`, { method: 'POST' }).catch(() => {})
    }
    ping()
    const interval = window.setInterval(ping, HEARTBEAT_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [slug])
}
