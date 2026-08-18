import { useEffect, useRef, useState } from 'react'
import { REFRESH_CHECK_URL } from '../config/captureEndpoint'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { isCaptureInProgress } from '../services/captureActivity'

// Lets a remote trigger (opened from a phone via the Worker's /refresh URL,
// or the platform-admin "Refresh displays" action) force this tab to
// reload - so a fix pushed from home can be picked up on ATC PC2 (or any
// tenant's live dashboard) without touching its keyboard/mouse. Polls a
// per-TENANT flag on the same Worker already used for capture logging.
//
// "Refresh displays" round - this used to poll one single GLOBAL flag,
// so any trigger (including AtcControlPage.tsx's own "Update Dashboard"
// side effect) reloaded EVERY tenant's live screen at once, not just the
// one it was meant for. Per-tenant scoping means this component now
// needs to know its OWN tenant first - it's mounted once at the top of
// App.tsx, above <Routes>, so unlike a page component it has no route
// param or page-level fetch to read that from. Self-fetches
// PUBLIC_CONFIG_URL (Host-header-resolved, same request every tenant
// dashboard already makes on load) purely to learn its own `slug` -
// on a host with no matching tenant (the login page, /platform/* admin
// routes), that resolves to a 404 and this component simply never starts
// polling at all, same harmless no-op those routes already got before
// per-tenant scoping existed.
//
// The Worker clears the flag the instant it's read, regardless of what we do
// with it - so `pendingReload` here is the client's own memory of "a reload
// was requested", kept across polls until it's actually safe to act on it.
// Never interrupts an in-progress capture: that's the one constraint that
// matters more than anything else about this feature.
const POLL_INTERVAL_MS = 12_000

export default function RemoteRefreshWatcher(): null {
  const pendingReload = useRef(false)
  const [tenantSlug, setTenantSlug] = useState<string | null>(null)
  const [resolvedTenant, setResolvedTenant] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { slug?: string | null } | null) => {
        if (!cancelled) setTenantSlug(data?.slug ?? null)
      })
      .catch(() => {
        if (!cancelled) setTenantSlug(null)
      })
      .finally(() => {
        if (!cancelled) setResolvedTenant(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Waits for the slug lookup above to finish (resolvedTenant) before
    // deciding whether to poll at all - starting to poll with a
    // not-yet-known slug would either 404 forever or (worse, if it ever
    // fell back to a hardcoded default) poll the WRONG tenant's flag.
    if (!resolvedTenant || !tenantSlug) return

    async function poll() {
      try {
        if (!pendingReload.current) {
          const response = await fetch(`${REFRESH_CHECK_URL}&tenant=${encodeURIComponent(tenantSlug as string)}`)
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
  }, [resolvedTenant, tenantSlug])

  return null
}
