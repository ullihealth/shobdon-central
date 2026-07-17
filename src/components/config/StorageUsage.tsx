import { useEffect, useState } from 'react'
import { MEDIA_LIBRARY_URL } from '../../config/publicApi'

// Same GET /api/tenant/media-library (functions/api/tenant/media-library/
// index.ts) MediaManagerPage.tsx already reads for its own usage bar -
// totalBytes/capBytes are already tenant-scoped (capBytes now reads
// tenants.storage_quota_bytes, migration 0028), so this needed no new
// endpoint, just a second, smaller consumer of the existing one.
function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function StorageUsage(): JSX.Element | null {
  const [totalBytes, setTotalBytes] = useState<number | null>(null)
  const [capBytes, setCapBytes] = useState(100 * 1024 * 1024)

  useEffect(() => {
    let cancelled = false
    fetch(MEDIA_LIBRARY_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setTotalBytes(data.totalBytes ?? 0)
        setCapBytes(data.capBytes ?? capBytes)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (totalBytes === null) return null

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-400">Media Storage</h3>
        <span className="text-xs text-muted-400">
          {formatMb(totalBytes)} of {formatMb(capBytes)} used
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-300">
        Camera thumbnails, carousel photos, and video slides all count toward this. Manage files in{' '}
        <span className="font-medium text-primary">Media Manager</span>.
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full bg-accent-sky-500"
          style={{ width: `${Math.min(100, (totalBytes / capBytes) * 100)}%` }}
        />
      </div>
    </div>
  )
}
