import { useEffect, useState } from 'react'

const PROBE_TIMEOUT_MS = 4000

// Tom Galloway/Gyroplane Train round: a freshly-provisioned tenant's
// subdomain (tenants.subdomain) is always a real, non-null DB value the
// moment the tenant row is created, but DNS/Cloudflare custom-domain
// setup for it is a separate, still-manual step (see onboard.ts's own
// comment) - so the exact same URL can be a genuine dead end for weeks.
// Header.tsx's logo link and DisplayUrlList.tsx's "Your Displays" card
// both need to tell "not live yet" apart from "actually broken" before
// presenting that host as clickable, rather than sending an admin into
// a raw DNS error with no explanation.
//
// mode: 'no-cors' deliberately never reads the response - a cross-origin
// opaque response is all a plain reachability check needs, and reading
// the body/status would require the target to also send permissive CORS
// headers, which a live tenant's own /api/public/config has no reason
// to do for this. Any settled promise (even an opaque 0-status response)
// means DNS resolved and a server answered; a browser network-level
// rejection (the one AbortController/timeout guards against hanging on
// forever) means it didn't - confirmed live via curl against a real
// unprovisioned subdomain (connection failure) vs. shobdon.
// airfieldcentral.com (200) before writing this.
//
// null = "still checking" (or host is null/not applicable) - both
// Header.tsx and DisplayUrlList.tsx treat that the same as "assume
// reachable" (this hook's pre-fix behaviour), matching this codebase's
// existing convention of never flashing a different state before a
// fetch resolves.
export function useHostReachable(host: string | null): boolean | null {
  const [reachable, setReachable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!host) {
      setReachable(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    fetch(`https://${host}/api/public/config`, { mode: 'no-cors', signal: controller.signal })
      .then(() => {
        if (!cancelled) setReachable(true)
      })
      .catch(() => {
        if (!cancelled) setReachable(false)
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [host])

  return reachable
}
