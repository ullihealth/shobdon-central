import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_UPDATES_URL } from '../config/publicApi'
import ReleasedVersionsList, { type ReleasedVersionEntry } from '../components/ReleasedVersionsList'

// Internal, app-wide running changelog (migration 0050) - deliberately
// NOT tenant-facing. Dev-features/Updates consolidation round: this page
// used to own the whole draft -> reviewed -> released workflow itself
// (New Draft Entry form, Pending/Reviewed containers, the Release
// action); all of that moved to /platform/dev-features, which is now
// the only place entries are created or worked on before release - see
// that page's own comment. This page is left showing only the
// permanent, released record, reusing ReleasedVersionsList.tsx so it
// renders identically to the public /versions page (VersionsPage.tsx),
// which serves the same data unauthenticated.
export default function PlatformUpdatesPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [updates, setUpdates] = useState<ReleasedVersionEntry[]>([])

  useEffect(() => {
    fetch(PLATFORM_UPDATES_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) setUpdates(data.updates ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <Link to="/platform/tenants" className="mb-4 inline-block text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          ← Platform · Tenants
        </Link>
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Developer Updates</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          The permanent, released record - entries here can no longer be edited. New entries, and everything before
          release, now live on{' '}
          <Link to="/platform/dev-features" className="text-accent-sky-400 hover:text-accent-sky-500">
            Developer Features
          </Link>
          .
        </p>

        {loading ? <p className="text-sm text-muted-400">Loading…</p> : <ReleasedVersionsList updates={updates} />}
      </div>
    </div>
  )
}
