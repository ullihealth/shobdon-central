import { useEffect, useState } from 'react'
import { useHostReachable } from '../../hooks/useHostReachable'

interface DisplayEntry {
  slug: string
  name: string
  templateId: string
}

interface DisplaysResponse {
  subdomain: string
  displays: DisplayEntry[]
}

interface DisplayUrlListProps {
  // Same cafeEntitled fact DesignPage.tsx already fetches from
  // /api/tenant/me for the Dashboard/Cafe toggle and café template
  // cards (#40 follow-up) - passed down rather than re-fetched here so
  // this list uses the exact same live value, including its trial-
  // expiry check, instead of the plain (non-expiry-aware) `entitled`
  // column already present per-row in the /api/tenant/displays response
  // this component fetches below.
  cafeEntitled: boolean
}

// Owner-only GET /api/tenant/displays (functions/api/tenant/displays.ts,
// tenant_displays / migration 0027) - lists every named display this
// tenant has (at minimum the seeded 'main' one) with its live /d/:slug
// URL, so an owner doesn't need to know the URL scheme by heart to find
// or share a display's link (e.g. for a new clubhouse TV).
export default function DisplayUrlList({ cafeEntitled }: DisplayUrlListProps): JSX.Element | null {
  const [data, setData] = useState<DisplaysResponse | null>(null)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/displays')
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // DNS-not-provisioned round (same caveat as Header.tsx's logo link -
  // see that file's own comment and useHostReachable's): every display
  // here shares one tenant, so one probe against data.subdomain covers
  // all of them - no per-row check needed. null (still loading, or no
  // data yet) falls through to "assume reachable" below, same as
  // Header.tsx's own default-while-checking behaviour.
  const subdomainReachable = useHostReachable(data?.subdomain ?? null)
  const subdomainConfirmedDown = subdomainReachable === false

  async function handleCopy(url: string, slug: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedSlug(slug)
      window.setTimeout(() => {
        setCopiedSlug((current) => (current === slug ? null : current))
      }, 1500)
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS context) - the URL is
      // still shown as plain selectable text, so this is a convenience
      // failing quietly, not a blocker to actually getting the link.
    }
  }

  if (!data) return null

  // 'cafe-tv' is the same slug me.ts joins tenant_displays on to compute
  // cafeEntitled (see that file's own comment) - dropped from the list
  // entirely rather than shown disabled, same treatment as the
  // Dashboard/Cafe toggle and café template cards it's gated alongside.
  const visibleDisplays = data.displays.filter((display) => cafeEntitled || display.slug !== 'cafe-tv')

  if (visibleDisplays.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-400">Your Displays</h3>
      <p className="mb-4 text-sm text-muted-300">
        Each named display has its own live URL - bookmark one on a clubhouse TV, or share it with anyone who needs
        that view.
      </p>
      <div className="space-y-3">
        {visibleDisplays.map((display) => {
          // Derived from wherever THIS page is actually being viewed
          // from (window.location.origin), not data.subdomain (the
          // tenant's real, DB-stored production subdomain) - was
          // hardcoded to that value regardless of environment, so
          // Copy/Open always pointed at production even when reviewing
          // a Cloudflare Pages preview deployment. data.subdomain is
          // still used below for the DNS-reachability check, a
          // genuinely different question (has this tenant's real custom
          // domain been provisioned at all) that's independent of
          // where this admin page itself is currently being viewed
          // from.
          const url = `${window.location.origin}/d/${display.slug}`
          return (
            <div
              key={display.slug}
              className="flex flex-col gap-2 rounded-xl border border-border bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-primary">{display.name}</span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-400">
                    {display.templateId}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-sm text-muted-300">{url}</div>
                {/* Informational only now, not a gate on Open below - url
                    is origin-relative (wherever this admin page is
                    actually being viewed from), which is reachable by
                    definition, so it's never the broken link this
                    warning used to guard against. data.subdomain (the
                    tenant's real custom domain) can still genuinely not
                    be provisioned yet - worth surfacing since that's the
                    address they'd actually want bookmarked on a
                    clubhouse TV long-term, just not what Open uses. */}
                {subdomainConfirmedDown && (
                  <div className="mt-1 text-xs text-amber-400">
                    Note: your own domain ({data.subdomain}) isn't set up yet - Open below uses this page's current
                    address instead. Contact support to get your own domain live.
                  </div>
                )}
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(url, display.slug)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
                >
                  {copiedSlug === display.slug ? 'Copied!' : 'Copy'}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
                >
                  Open
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
