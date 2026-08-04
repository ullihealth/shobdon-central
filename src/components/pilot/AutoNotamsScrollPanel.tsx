import { useEffect, useState } from 'react'
import { NOTAMS_URL } from '../../config/publicApi'

type NotamSeverity = 'critical' | 'warning' | 'info'

interface AutoNotam {
  id: string
  icao: string
  text: string
  effectiveFrom: string | null
  effectiveTo: string | null
  severity: NotamSeverity
}

const SEVERITY_ORDER: Record<NotamSeverity, number> = { critical: 0, warning: 1, info: 2 }
const SEVERITY_DOT_CLASSES: Record<NotamSeverity, string> = {
  critical: 'bg-status-bad',
  warning: 'bg-status-warn',
  info: 'bg-muted-400',
}

// Pilot View (Section 7 - NOTAMs, full panel, no truncation) - fetches
// the same automated feed RightInfoPanel.tsx does (NOTAMS_URL), but is
// a genuinely new component, not a reuse/export of that file's internal
// AutoNotamsFullPanel: that component measures scrollHeight against a
// FIXED clientHeight and drops whole entries to fit a non-scrolling TV
// card - the exact opposite of what this naturally-scrolling mobile
// page needs. This component instead renders every entry, full text,
// no cap, no height measurement, letting the page itself scroll.
//
// Deliberately ignores opsPanel.showAutoNotams (ATC's own carousel-
// timing toggle for the TV rotation) - see the approved plan's own
// flagged note: this page has dedicated, permanent, non-carousel space
// for NOTAMs, and NOTAMs are safety-relevant, so they always render
// here regardless of whether a given tenant has chosen to skip them in
// the TV carousel's own rotation.
export default function AutoNotamsScrollPanel({ refreshSignal }: { refreshSignal?: number }): JSX.Element {
  const [notams, setNotams] = useState<AutoNotam[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(NOTAMS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.notams)) setNotams(data.notams)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [refreshSignal])

  const sorted = [...(notams ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <div className="mb-3 text-center text-sm font-semibold uppercase tracking-[0.25em] text-muted-400">NOTAMs</div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-500">No active NOTAMs.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((notam) => (
            <div key={notam.id} className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-sm text-primary">
              <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT_CLASSES[notam.severity]}`} />
              <span>{notam.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
