import { useEffect, useState } from 'react'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'

interface OpsPanelPublic {
  activeRunwayEnd: string
  circuitDirection: string
  runwaysClosed: boolean
}

// 'RIGHT HAND'/'LEFT HAND' - ops_panel_state.circuitDirection
// (migrations/0009_ops_panel_state.sql) is a single 'left'|'right' field
// tied to whichever end is currently activeRunwayEnd - there is no
// independently-stored circuit direction for the reciprocal end, which is
// also why this card shows the active end only, not a reciprocal
// identifier at all (confirmed with the user before building this - a
// second, guessed value has no place on a safety-relevant readout).
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
// A single compact full-width row, not a titled card - this is safety-
// relevant, at-a-glance information a pilot shouldn't have to spend a
// full card's worth of scroll-space on, not something needing NOTAMs/
// Forecast's own collapsible treatment either (it's the opposite of
// "collapse this away by default" - it should always be immediately
// visible). Text sized deliberately large/bold (~80% bigger than this
// card's first pass) given what it's actually for - this is the one
// piece of information on the whole page a pilot most needs to get right
// at a glance, so it should read that way, not like just another stat
// card. The active runway/hand renders in the exact same accent-sky-400
// token the Notices section title already uses elsewhere on this page
// (var(--color-accent-sky-400), src/index.css) - reused as the actual
// Tailwind colour class, not approximated as a literal hex, so it stays
// in sync if that token's own value ever changes.
export default function RunwayInUseCard({ refreshSignal }: { refreshSignal?: number }): JSX.Element {
  const [opsPanel, setOpsPanel] = useState<OpsPanelPublic | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setOpsPanel(data?.opsPanel ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshSignal])

  const activeEnd = opsPanel?.activeRunwayEnd ?? '08'

  if (opsPanel?.runwaysClosed) {
    return (
      <div className="rounded-xl border-2 border-status-bad/50 bg-status-bad/10 px-4 py-3 text-center text-2xl font-extrabold uppercase tracking-wide text-status-bad">
        Runways Closed
      </div>
    )
  }

  return (
    <div className="flex items-baseline justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-panel px-4 py-4 text-center">
      <span className="text-2xl font-semibold uppercase tracking-wide text-muted-400">Runway:</span>
      <span className="text-4xl font-extrabold text-accent-sky-400">
        {activeEnd} {handLabel(opsPanel?.circuitDirection ?? 'left')}
      </span>
    </div>
  )
}
