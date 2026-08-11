import { useEffect, useState } from 'react'
import { PUBLIC_VERSIONS_URL } from '../../config/publicApi'

interface ReleasedUpdate {
  version: string
}

// Pilot View footer version stamp - self-fetches the SAME public,
// unauthenticated endpoint (functions/api/public/versions.ts, already
// Cache-Control: no-store) VersionsPage.tsx (/versions) uses, rather
// than a package.json "version" field - that number was a second,
// disconnected value nobody was actually bumping per release, not a
// real single source of truth. platform_updates.version (assigned via
// /platform/dev-features's own release workflow - see that table's own
// migration comment) is the real one: version is only ever stamped at
// release time, and the endpoint already returns every released row
// sorted DESCENDING by version using a proper numeric comparator (see
// versionSort.ts's own comment on why a plain string sort would be
// wrong here - 'v1.10.0' < 'v1.2.0' lexicographically) - so the CURRENT
// version is simply the first entry, no separate "current version"
// field/endpoint needed.
//
// Same self-contained "own fetch, own state, render nothing if there's
// nothing real to show" shape as PilotFooterTicker.tsx's own
// hasRealContent gate - a loading/failed fetch renders nothing rather
// than a stale/placeholder version number.
//
// refreshSignal - the same shared refreshTick PilotViewPage.tsx already
// threads into PilotRunwayWindPanel/AutoNotamsScrollPanel/
// PilotNoticesPanel (bumped by both the 60s auto-interval and pull-to-
// refresh) - this component just never read it before, which meant a
// pilot who pulled to refresh right after a new version shipped kept
// seeing the version their tab first loaded with until a full app
// restart. Included in the fetch effect's own dependency array, same
// pattern those three components already use, so a bump re-runs the
// fetch exactly the same way it does for them. Deliberately doesn't
// reset `label` to null when a refetch starts - same as those other
// panels' own state handling - so the stamp keeps showing the last
// known-good version throughout a refetch (and stays on it if a
// refetch fails) rather than flickering blank.
export default function PilotVersionStamp({ refreshSignal }: { refreshSignal?: number }): JSX.Element | null {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_VERSIONS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { updates?: ReleasedUpdate[] } | null) => {
        const current = data?.updates?.[0]?.version
        if (cancelled || !current) return
        // version is free-text typed into the release form (see
        // versionSort.ts's own comment) - could already start with a
        // 'v'/'V'. Stripped before applying this label's own fixed "V"
        // prefix so a "v1.12.0" release can never render as "Vv1.12.0".
        setLabel(`AIRFIELD CENTRAL V${current.replace(/^v/i, '')}`)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshSignal])

  if (!label) return null

  return (
    <div className="w-full bg-panel/80 px-2 py-0.5 text-center text-[10px] font-medium tracking-wide text-muted-400 backdrop-blur">
      {label}
    </div>
  )
}
