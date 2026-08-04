import { useEffect, useState } from 'react'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'

interface OpsPanelPublic {
  activeRunwayEnd: string
  circuitDirection: string
  runwaysClosed: boolean
}

// 'Left'/'Right' - same condensed labels RightInfoPanel.tsx uses so the
// value fits its own grid cell on one line.
function circuitDirectionLabel(direction: string): string {
  return direction === 'right' ? 'Right' : 'Left'
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

  const runwayStatusValue = opsPanel ? opsPanel.activeRunwayEnd : '08/26'
  const circuitDirectionValue = `${circuitDirectionLabel(opsPanel?.circuitDirection ?? 'left')} circuit`

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 text-center text-sm font-semibold uppercase tracking-[0.25em] text-muted-400">Runway In Use</div>
      {opsPanel?.runwaysClosed ? (
        <div className="rounded-xl border border-status-bad/40 bg-status-bad/10 p-4 text-center text-2xl font-semibold text-status-bad">
          RUNWAYS CLOSED
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
          <div className="flex-shrink-0 text-2xl font-semibold text-primary">{runwayStatusValue}</div>
          <div className="flex-1 text-2xl font-semibold text-primary">{circuitDirectionValue}</div>
        </div>
      )}
    </section>
  )
}
