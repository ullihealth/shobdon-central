import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'

type NoticeSize = 'sm' | 'md' | 'lg'

interface SafetyNotice {
  text: string
  size: NoticeSize
  enabled: boolean
}

interface OpsPanelPublic {
  activeRunwayEnd: string
  circuitDirection: string
  airfieldInfoText: string
  safetyNotices: SafetyNotice[]
  showAutoNotams: boolean
  notamsCarouselIntervalSeconds: number
}

function circuitDirectionLabel(direction: string): string {
  return direction === 'right' ? 'Right-hand' : 'Left-hand'
}

// 'md' matches today's existing fixed text-lg exactly - a notice left
// at the default size renders pixel-identical to before per-notice
// sizing existed. 'sm'/'lg' stay well below the old text-3xl (30px)
// that originally motivated a smaller size for this list-style panel.
const SIZE_CLASSES: Record<NoticeSize, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
}

// State B's content - each notice as its own block, blank-line-separated,
// smaller/scannable text (not text-3xl, which is sized for a single
// glanceable value, not a list). overflow-hidden here is the hard
// guarantee against ever visually breaking the page layout again,
// regardless of how much text ATC enters - independent of, and not
// reliant on, the JS truncation logic below being correct. That logic
// just makes the guarantee graceful instead of an abrupt silent chop:
// it measures actual rendered height and drops complete entries from
// the end, one at a time, until what's left plus a "+N more" indicator
// actually fits - so anyone looking at the display can always tell more
// notices exist rather than seeing a cut-off fragment.
function NotamsPanel({ notices }: { notices: SafetyNotice[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(notices.length)

  useLayoutEffect(() => {
    setVisibleCount(notices.length)
  }, [notices])

  // Measures real rendered scrollHeight vs clientHeight - size-agnostic
  // by construction, so per-entry font sizes (sm/md/lg) need no changes
  // here: a 'lg' entry naturally contributes more to scrollHeight than
  // a 'sm' one, and the loop responds to whatever the real number is,
  // same as it already does for a long string wrapping to two lines.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || visibleCount <= 0) return
    if (el.scrollHeight > el.clientHeight) {
      setVisibleCount((count) => count - 1)
    }
  }, [visibleCount, notices])

  const hiddenCount = notices.length - visibleCount

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5">
      <div className="flex-shrink-0 text-xs uppercase tracking-[0.25em] text-muted-500">NOTAMS</div>
      <div ref={containerRef} className="mt-3 min-h-0 flex-1 overflow-hidden">
        {notices.slice(0, visibleCount).map((notice, index) => (
          <div key={index} className={`mb-4 font-semibold text-primary last:mb-0 ${SIZE_CLASSES[notice.size]}`}>
            {notice.text}
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="text-lg font-bold text-status-bad">
            +{hiddenCount} more — see /atc-control
          </div>
        )}
      </div>
    </div>
  )
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

  // Plain 2-state flip, not a carousel - MediaPanel.tsx's per-slot
  // recursive setTimeout exists to support independently-durationed
  // slots; there's exactly one shared interval driving a single A/B
  // toggle here, so a plain setInterval is the correct, simpler fit.
  // Always starts on State A (today's default appearance) on load/on
  // any config refetch, then flips every notamsCarouselIntervalSeconds.
  const [showNotamsState, setShowNotamsState] = useState(false)

  useEffect(() => {
    setShowNotamsState(false)
    const intervalSeconds = opsPanel?.notamsCarouselIntervalSeconds ?? 5
    const id = window.setInterval(() => {
      setShowNotamsState((value) => !value)
    }, Math.max(1, intervalSeconds) * 1000)
    return () => window.clearInterval(id)
  }, [opsPanel?.notamsCarouselIntervalSeconds])

  // Same liveDataUnavailable treatment as LeftInfoPanel's Notices row -
  // an empty notams array during an unintended mock fallback would
  // otherwise read as a false "No active notices" all-clear. showAutoNotams
  // defaults true (matches the DB column default) so a tenant that's never
  // touched /atc-control keeps today's exact auto-NOTAM behaviour - when
  // explicitly turned off, the auto feed is skipped entirely, even if the
  // station is actively reporting one, leaving only the manual rows.
  const showAutoNotams = opsPanel?.showAutoNotams ?? true
  // Auto-NOTAMs are pulled, not authored - always the fixed default
  // size, no per-notice size control exposed for them (that's only for
  // the manual rows, which already come as {text,size} from opsPanel).
  const autoNotams: SafetyNotice[] =
    !weather || liveDataUnavailable || !showAutoNotams
      ? []
      : weather.notams.map((text) => ({ text, size: 'md' as const, enabled: true }))
  // enabled === false explicitly excludes a row from display entirely
  // (not greyed out, not counted toward "+N more" - simply absent from
  // the array NotamsPanel ever sees). !== false rather than === true so
  // a missing/undefined field (shouldn't happen post-migration, but
  // defensive against any stale/unexpected data) defaults to shown,
  // matching the migration's own enabled=true default.
  const manualNotices = (opsPanel?.safetyNotices ?? []).filter((n) => n.enabled !== false)
  const allNotices = [...autoNotams, ...manualNotices]
  // 'N/A' as a single block preserves the exact prior informational
  // behaviour (weather/mock-fallback uncertainty overrides even real
  // manual notices) while fitting State B's one-block-per-entry shape.
  const noticesForDisplay: SafetyNotice[] =
    !weather || liveDataUnavailable
      ? [{ text: 'N/A', size: 'md', enabled: true }]
      : allNotices.length > 0
        ? allNotices
        : [{ text: 'No active notices', size: 'md', enabled: true }]

  // Runway Status and Circuit Direction come from ops_panel_state (set
  // via /atc-control); a null opsPanel (no /atc-control usage yet on
  // this tenant) falls back to the same static defaults this file used
  // to hardcode, rather than showing blank cards. NOTAMS is no longer a
  // 4th entry here - it's State B's own full panel below.
  //
  // Airfield Info is a free-text field an admin may leave unset - unlike
  // the two fields above, there's no sensible non-empty default to fall
  // back to, so this card is only included when there's a genuine
  // non-empty value to show, rather than displaying a hardcoded string
  // that would look like real data but isn't.
  const airfieldInfoText = opsPanel?.airfieldInfoText.trim()
  const cards = [
    { title: 'Runway Status', value: opsPanel ? `${opsPanel.activeRunwayEnd} Open` : '08/26 Open' },
    { title: 'Circuit Direction', value: circuitDirectionLabel(opsPanel?.circuitDirection ?? 'left') },
    ...(airfieldInfoText ? [{ title: 'Airfield Info', value: airfieldInfoText }] : []),
  ]

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 flex-shrink-0 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">
        Ops Panel
      </div>
      <div className="min-h-0 flex-1">
        {showNotamsState ? (
          <NotamsPanel notices={noticesForDisplay} />
        ) : (
          <div className="grid gap-4">
            {cards.map((card) => (
              <div key={card.title} className="rounded-3xl border border-border bg-card p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{card.title}</div>
                <div className="mt-3 text-3xl font-semibold text-primary">{card.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
