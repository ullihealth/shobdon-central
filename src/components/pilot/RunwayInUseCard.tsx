import { useEffect, useState } from 'react'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'

interface OpsPanelPublic {
  activeRunwayEnd: string
  circuitDirection: string
  runwaysClosed: boolean
}

interface RunwayGroupPublic {
  endAIdentifier: string
  endBIdentifier: string
}

// 'RIGHT HAND'/'LEFT HAND' - ops_panel_state.circuitDirection
// (migrations/0009_ops_panel_state.sql) is a single 'left'|'right' field
// tied to whichever end is currently activeRunwayEnd - there is no
// independently-stored circuit direction for the reciprocal end. This is
// why the reciprocal end below never gets a hand label of its own: one
// isn't real stored data, only ever a guess, and guessing it wrong is
// exactly the kind of thing that shouldn't ship on a safety-relevant
// runway-in-use readout (confirmed with the user before building this).
function handLabel(direction: string): string {
  return direction === 'right' ? 'RIGHT HAND' : 'LEFT HAND'
}

// Pilot View extraction (Section 5 - Runway in use / circuit direction) -
// copies RightInfoPanel.tsx's "Runway In Use" card content/logic rather
// than importing or delegating to that file, since RightInfoPanel is not
// otherwise reusable standalone for this piece (it was never split out)
// and this page needs its own mobile-appropriate sizing regardless (same
// reasoning WeatherStatGrid.tsx's own comment gives) - matches this
// codebase's own established precedent of duplicating a small, genuinely-
// diverging amount of logic rather than forcing a shared abstraction
// (see RightInfoPanel.tsx's own NotamsPanel/AutoNotamsFullPanel comment
// for the same reasoning applied elsewhere in this exact file).
// Self-fetches PUBLIC_CONFIG_URL, same pattern RightInfoPanel itself uses.
// refreshSignal (bumped by PilotViewPage.tsx's 60s tick) triggers a re-
// fetch without remounting.
//
// Redesigned to a single compact full-width row (was a titled card with
// its own padded sub-card) - this is safety-relevant, at-a-glance
// information a pilot shouldn't have to spend a full card's worth of
// scroll-space on, not something needing NOTAMs/Forecast's own
// collapsible treatment either (it's the opposite of "collapse this away
// by default" - it should always be immediately visible).
export default function RunwayInUseCard({ refreshSignal }: { refreshSignal?: number }): JSX.Element {
  const [opsPanel, setOpsPanel] = useState<OpsPanelPublic | null>(null)
  const [runwayGroup, setRunwayGroup] = useState<RunwayGroupPublic | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setOpsPanel(data?.opsPanel ?? null)
        setRunwayGroup(data?.runwayGroups?.[0] ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshSignal])

  const activeEnd = opsPanel?.activeRunwayEnd ?? '08'
  const reciprocalEnd = runwayGroup
    ? runwayGroup.endAIdentifier === activeEnd
      ? runwayGroup.endBIdentifier
      : runwayGroup.endAIdentifier
    : null

  if (opsPanel?.runwaysClosed) {
    return (
      <div className="rounded-xl border-2 border-status-bad/50 bg-status-bad/10 px-4 py-2 text-center text-xl font-extrabold uppercase tracking-wide text-status-bad">
        Runways Closed
      </div>
    )
  }

  return (
    <div className="flex items-baseline justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-panel px-4 py-2 text-center">
      <span className="text-sm font-semibold uppercase tracking-wide text-muted-400">Runway:</span>
      <span className="text-xl font-extrabold text-primary">
        {activeEnd} {handLabel(opsPanel?.circuitDirection ?? 'left')}
      </span>
      {reciprocalEnd && <span className="text-base font-medium text-muted-500">({reciprocalEnd})</span>}
    </div>
  )
}
