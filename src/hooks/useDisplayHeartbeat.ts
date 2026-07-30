import { useEffect } from 'react'

// 30 minutes - reduced from the original 3-minute interval (the uptime
// tracking work no longer needs finer-grained pings; this is purely
// about "is the display still on", not real-time monitoring). The
// server-side dedup window in functions/api/public/heartbeat.ts is now
// shorter than this interval, so every ping at this cadence writes its
// own row - see that file's own comment. The Uptime Report's expected-
// heartbeats math (functions/api/platform/uptime-report.ts) assumes
// this exact value; change both together.
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000

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
