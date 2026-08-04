import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PUBLIC_VERSIONS_URL } from '../config/publicApi'
import ReleasedVersionsList, { type ReleasedVersionEntry } from '../components/ReleasedVersionsList'

// Public, unauthenticated - GET PUBLIC_VERSIONS_URL (functions/api/public/
// versions.ts). Same released/version-grouped data + rendering
// (ReleasedVersionsList.tsx) as the developer-only /platform/updates,
// fetched from its own public endpoint rather than a shared/gated one -
// dev-features/Updates consolidation round. Linked from /features's own
// "Versions" button, same fixed neutral-palette posture as
// GlobalDashboardPage.tsx (not the theme-token classes DashboardPage.tsx
// uses, for the same reason that page's own comment gives - this
// represents every tenant equally, not any one tenant's branding).
export default function VersionsPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [updates, setUpdates] = useState<ReleasedVersionEntry[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_VERSIONS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) setUpdates(data.updates ?? [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen w-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <Link to="/features" className="mb-4 inline-block text-xs font-semibold text-sky-400 hover:text-sky-300">
          ← Feature Requests
        </Link>
        <h1 className="mb-2 text-2xl font-bold">Airfield Central — Version History</h1>
        <p className="mb-8 text-sm text-slate-400">What's shipped, grouped by release.</p>

        {loading ? <p className="text-sm text-slate-400">Loading…</p> : <ReleasedVersionsList updates={updates} />}
      </div>
    </div>
  )
}
