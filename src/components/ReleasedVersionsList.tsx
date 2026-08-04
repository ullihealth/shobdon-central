// Shared, presentational-only rendering for the released/version-grouped
// changelog - extracted from PlatformUpdatesPage.tsx (dev-features/
// Updates consolidation round) so both that now-simplified page and the
// new public VersionsPage.tsx render the identical grouping from their
// own, independently-fetched data (one authenticated, one not) rather
// than maintaining two copies of this logic. No fetching of its own -
// callers already sorted `updates` newest-version-first (see
// versionSort.ts) before passing it in.
export interface ReleasedVersionEntry {
  id: string
  title: string
  description: string
  version: string
  releasedAt: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ReleasedVersionsList({ updates }: { updates: ReleasedVersionEntry[] }): JSX.Element {
  // Group by version, preserving the caller's own ordering rather than
  // re-sorting here - see versionSort.ts's own comment for why a plain
  // sort on the version string would be wrong.
  const releasedByVersion: { version: string; releasedAt: string; entries: ReleasedVersionEntry[] }[] = []
  for (const entry of updates) {
    const group = releasedByVersion.find((g) => g.version === entry.version)
    if (group) group.entries.push(entry)
    else releasedByVersion.push({ version: entry.version, releasedAt: entry.releasedAt, entries: [entry] })
  }

  if (releasedByVersion.length === 0) {
    return <p className="text-xs text-muted-500">Nothing released yet.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {releasedByVersion.map((group) => (
        <div key={group.version}>
          <div className="mb-2 flex items-baseline gap-3 border-b border-border pb-2">
            <span className="text-lg font-black text-primary">v{group.version.replace(/^v/i, '')}</span>
            <span className="text-xs text-muted-500">Released {formatDate(group.releasedAt)}</span>
          </div>
          <div className="flex flex-col gap-3">
            {group.entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                <div className="text-sm font-semibold text-primary">{entry.title}</div>
                <p className="mt-1 text-xs text-muted-400">{entry.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
