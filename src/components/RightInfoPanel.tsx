import { useEffect, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'

interface OpsPanelPublic {
  activeRunwayEnd: string
  circuitDirection: string
  airfieldInfoText: string
  safetyNotices: string[]
  showAutoNotams: boolean
}

function circuitDirectionLabel(direction: string): string {
  return direction === 'right' ? 'Right-hand' : 'Left-hand'
}

export default function RightInfoPanel(): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()

  // Self-contained fetch of the public config, matching MediaPanel.tsx's
  // established pattern (each panel independently fetches what it needs
  // rather than threading props down from DashboardPage) - a null
  // opsPanel (e.g. a tenant that's never used /atc-control) falls back
  // to sensible static defaults below rather than rendering blank cards.
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
  }, [])

  // Same liveDataUnavailable treatment as LeftInfoPanel's Notices row -
  // an empty notams array during an unintended mock fallback would
  // otherwise read as a false "No active notices" all-clear. showAutoNotams
  // defaults true (matches the DB column default) so a tenant that's never
  // touched /atc-control keeps today's exact auto-NOTAM behaviour - when
  // explicitly turned off, the auto feed is skipped entirely, even if the
  // station is actively reporting one, leaving only the manual rows.
  const showAutoNotams = opsPanel?.showAutoNotams ?? true
  const autoNotams =
    !weather || liveDataUnavailable || !showAutoNotams ? [] : weather.notams
  const manualNotices = opsPanel?.safetyNotices ?? []
  const allNotices = [...autoNotams, ...manualNotices]
  const safetyNoticesValue =
    !weather || liveDataUnavailable
      ? 'N/A'
      : allNotices.length > 0
        ? allNotices.join(' • ')
        : 'No active notices'

  // Runway Status and Circuit Direction come from ops_panel_state (set
  // via /atc-control); Airfield Info is now a free-text field there too,
  // not a fixed club fact. A null opsPanel (no /atc-control usage yet on
  // this tenant) falls back to the same static defaults this file used
  // to hardcode, rather than showing blank cards.
  const cards = [
    { title: 'Runway Status', value: opsPanel ? `${opsPanel.activeRunwayEnd} Open` : '08/26 Open' },
    { title: 'Circuit Direction', value: circuitDirectionLabel(opsPanel?.circuitDirection ?? 'left') },
    { title: 'Airfield Info', value: opsPanel?.airfieldInfoText || 'PPR only after 17:00' },
    { title: 'Safety Notices', value: safetyNoticesValue },
  ]

  return (
    <div className="h-full rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">Ops Panel</div>
      <div className="grid gap-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-3xl border border-border bg-card p-5">
            <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{card.title}</div>
            <div className="mt-3 text-3xl font-semibold text-primary">{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
