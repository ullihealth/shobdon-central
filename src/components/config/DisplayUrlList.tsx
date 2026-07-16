import { useEffect, useState } from 'react'

interface DisplayEntry {
  slug: string
  name: string
  templateId: string
}

interface DisplaysResponse {
  subdomain: string
  displays: DisplayEntry[]
}

// Owner-only GET /api/tenant/displays (functions/api/tenant/displays.ts,
// tenant_displays / migration 0027) - lists every named display this
// tenant has (at minimum the seeded 'main' one) with its live /d/:slug
// URL, so an owner doesn't need to know the URL scheme by heart to find
// or share a display's link (e.g. for a new clubhouse TV).
export default function DisplayUrlList(): JSX.Element | null {
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

  if (!data || data.displays.length === 0) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-400">Your Displays</h3>
      <p className="mb-4 text-sm text-muted-300">
        Each named display has its own live URL - bookmark one on a clubhouse TV, or share it with anyone who needs
        that view.
      </p>
      <div className="space-y-3">
        {data.displays.map((display) => {
          const url = `https://${data.subdomain}/d/${display.slug}`
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
