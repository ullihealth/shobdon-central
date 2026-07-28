import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWeather } from '../context/WeatherContext'
import { NOTAMS_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'

type NoticeSize = 'sm' | 'md' | 'lg' | 'xl'

interface SafetyNotice {
  text: string
  size: NoticeSize
  enabled: boolean
}

export interface OpsPanelPublic {
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

type NotamSeverity = 'critical' | 'warning' | 'info'

interface AutoNotam {
  id: string
  icao: string
  text: string
  effectiveFrom: string | null
  effectiveTo: string | null
  severity: NotamSeverity
}

// This file's own existing status-token classes (already used for the
// NOTAMS "+N more" indicator below), not CompassPanel.tsx's raw Tailwind
// colours - CompassPanel is out of scope and uses a different,
// non-themeable convention for its own headwind/crosswind cues.
const SEVERITY_DOT_CLASSES: Record<NotamSeverity, string> = {
  critical: 'bg-status-bad',
  warning: 'bg-status-warn',
  info: 'bg-muted-400',
}

const SEVERITY_ORDER: Record<NotamSeverity, number> = { critical: 0, warning: 1, info: 2 }

const MAX_AUTO_NOTAMS_SHOWN = 3

// Shifted up one step from the original sm/md/lg=16/18/20px tier: each
// existing saved notice keeps its tier label (a notice saved as "md"
// stays "md") but now renders one Tailwind type-scale step larger than
// before - a deliberate, visible size increase, not a preserved value.
// lg and the new xl continue the same step-by-step progression (each
// tier the next size up in Tailwind's own default scale) rather than
// jumping to an arbitrary pixel value.
const SIZE_CLASSES: Record<NoticeSize, string> = {
  sm: 'text-lg', // 18px (was md's size)
  md: 'text-xl', // 20px (was lg's size)
  lg: 'text-2xl', // 24px - new, genuinely larger than old lg
  xl: 'text-3xl', // 30px - new largest tier
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
// Stays private to this file (not exported) - Clubhouse2Template.tsx's
// "fixed notices panel" reuses it via RightInfoPanel's own new
// notamsOnly prop below, not by importing this directly, since the
// notices array it needs is derived from state (useWeather + opsPanel
// fetch) that lives in RightInfoPanel, not passed in from outside.
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

interface RightInfoPanelProps {
  // When true, skips the A/B flip timer and the Runway Status/Circuit
  // Direction/Airfield Info cards entirely, always rendering just
  // NotamsPanel - Clubhouse Template 2's "fixed notices panel...
  // statically displayed rather than rotating". Default false/undefined
  // - Template 1/Café's existing full flip behaviour is unaffected.
  notamsOnly?: boolean
  // When provided, skips the self-fetch below entirely and uses this
  // instead - added this round after tracing a real cross-tenant leak
  // traced to this exact pattern (see MediaPanel.tsx's own `data` prop
  // comment for the full story). PUBLIC_CONFIG_URL resolves by Host
  // header, correct for the real public dashboard but wrong for an
  // authenticated admin preview (DesignPage.tsx renders this component
  // via Clubhouse1Template/Clubhouse2Template) where the admin's session
  // may be switched to a different org than whatever subdomain they're
  // actually on - this is exactly the component that showed another
  // tenant's real safety notices in that scenario. Every existing
  // caller (the real public dashboard) omits this and is unaffected.
  opsPanelData?: OpsPanelPublic | null
}

export default function RightInfoPanel({ notamsOnly, opsPanelData }: RightInfoPanelProps = {}): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()

  // Self-contained fetch of the public config, matching MediaPanel.tsx's
  // established pattern (each panel independently fetches what it needs
  // rather than threading props down from DashboardPage) - a null
  // opsPanel (e.g. a tenant that's never used /atc-control) falls back
  // to sensible static defaults below rather than rendering blank cards.
  // Skipped entirely when opsPanelData is provided (see that prop's own
  // comment).
  const [opsPanel, setOpsPanel] = useState<OpsPanelPublic | null>(opsPanelData ?? null)

  useEffect(() => {
    if (opsPanelData !== undefined) {
      setOpsPanel(opsPanelData)
      return
    }
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
  }, [opsPanelData])

  // Automated NOTAM feed (functions/api/public/notams.ts) - fetched once
  // here at top-level mount, NOT inside the cards branch below. The A/B
  // carousel swaps its two states via a ternary (unmount/remount, not
  // CSS-hide), so a fetch living inside that branch would refetch on
  // every ~5-10s flip; holding it in this component's own state instead
  // means it survives the flip untouched. Depends on
  // opsPanel?.showAutoNotams specifically (not the whole opsPanel object)
  // so it fires exactly once when that flag's real value first becomes
  // known, and never refires just because some unrelated opsPanel field
  // changed (e.g. a live admin-preview edit to safetyNotices). Never
  // fetches at all when the flag is off - no point hitting even a cached
  // endpoint for data that will never be shown.
  const [autoNotams, setAutoNotams] = useState<AutoNotam[] | null>(null)

  useEffect(() => {
    if (!opsPanel?.showAutoNotams) return
    let cancelled = false
    fetch(NOTAMS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.notams)) setAutoNotams(data.notams)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [opsPanel?.showAutoNotams])

  // Plain 2-state flip, not a carousel - MediaPanel.tsx's per-slot
  // recursive setTimeout exists to support independently-durationed
  // slots; there's exactly one shared interval driving a single A/B
  // toggle here, so a plain setInterval is the correct, simpler fit.
  // Always starts on State A (today's default appearance) on load/on
  // any config refetch, then flips every notamsCarouselIntervalSeconds.
  const [showNotamsState, setShowNotamsState] = useState(false)

  useEffect(() => {
    setShowNotamsState(false)
    if (notamsOnly) return
    const intervalSeconds = opsPanel?.notamsCarouselIntervalSeconds ?? 5
    const id = window.setInterval(() => {
      setShowNotamsState((value) => !value)
    }, Math.max(1, intervalSeconds) * 1000)
    return () => window.clearInterval(id)
  }, [notamsOnly, opsPanel?.notamsCarouselIntervalSeconds])

  // showAutoNotams now gates the automated feed in the OTHER carousel
  // state (the cards branch below, "Runway In Use") rather than anything
  // here - see autoNotamEntries/the Automated NOTAM section further
  // down. This panel (State B) went back to manual notices only: the old
  // weather.notams-sourced auto feed it used to merge in here was never
  // actually a live external NOTAM source (it was whatever text showed
  // up in a specific field scraped off the local ATC weather-station
  // page, effectively always empty in practice) - real automated NOTAMs
  // now come from functions/api/public/notams.ts instead, surfaced next
  // to Runway Status/Circuit Direction where they're more visible.
  const showAutoNotams = opsPanel?.showAutoNotams ?? true
  // enabled === false explicitly excludes a row from display entirely
  // (not greyed out, not counted toward "+N more" - simply absent from
  // the array NotamsPanel ever sees). !== false rather than === true so
  // a missing/undefined field (shouldn't happen post-migration, but
  // defensive against any stale/unexpected data) defaults to shown,
  // matching the migration's own enabled=true default.
  const manualNotices = (opsPanel?.safetyNotices ?? []).filter((n) => n.enabled !== false)
  // 'N/A' as a single block preserves the exact prior informational
  // behaviour (weather/mock-fallback uncertainty overrides even real
  // manual notices) while fitting State B's one-block-per-entry shape.
  const noticesForDisplay: SafetyNotice[] =
    !weather || liveDataUnavailable
      ? [{ text: 'N/A', size: 'md', enabled: true }]
      : manualNotices.length > 0
        ? manualNotices
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
  // Runway Status and Circuit Direction used to be two separate cards -
  // combined per ATC feedback into one "Runway In Use" card, two values
  // side by side, since circuit direction is fixed per runway at this
  // airfield and reading them apart was extra work. Still two independent
  // values under the hood (see AtcControlPage.tsx's auto-link toggle) -
  // this is purely how they're displayed, not a data change.
  const runwayStatusValue = opsPanel ? `${opsPanel.activeRunwayEnd} Open` : '08/26 Open'
  const circuitDirectionValue = `${circuitDirectionLabel(opsPanel?.circuitDirection ?? 'left')} circuit`
  const cards = [...(airfieldInfoText ? [{ title: 'Airfield Info', value: airfieldInfoText }] : [])]

  // Critical first. Capped to 3 with a quiet "+N more" rather than
  // internal scrolling, matching NotamsPanel's own "+N more" convention
  // for State B. Nothing rendered at all while autoNotams is still null
  // (not yet fetched) or genuinely empty - unlike Runway Status/Circuit
  // Direction there's no "N/A"-style placeholder for this section, since
  // right now (no provider credentials configured yet) it will always be
  // empty for every tenant regardless of the toggle - see
  // functions/api/public/notams.ts's own comment.
  const sortedAutoNotams = [...(autoNotams ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const visibleAutoNotams = sortedAutoNotams.slice(0, MAX_AUTO_NOTAMS_SHOWN)
  const hiddenAutoNotamsCount = sortedAutoNotams.length - visibleAutoNotams.length

  // notamsOnly skips the "Ops Panel" heading/flip-state wrapper entirely -
  // NotamsPanel already renders its own complete, self-styled bordered
  // card (matching how CompassPanel/MediaPanel are self-contained "drop
  // in anywhere" components), so this is a plain h-full passthrough.
  if (notamsOnly) {
    return (
      <div className="h-full">
        <NotamsPanel notices={noticesForDisplay} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-panel p-6 shadow-xl shadow-slate-950/20">
      <div className="mb-5 flex-shrink-0 text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">
        Ops Panel
      </div>
      <div className="min-h-0 flex-1">
        {showNotamsState ? (
          <NotamsPanel notices={noticesForDisplay} />
        ) : (
          // Content-sized, not stretched to fill the column (previously a
          // `grid h-full` with `minmax(6.5rem, 1fr)` rows, forcing each
          // card to grow tall with empty space below its label+value -
          // that stretching is deliberately removed now: the Ops Panel
          // column needs its real unused height reclaimed as genuine free
          // space for a future carousel element, not consumed by two
          // over-tall cards. flex-col + gap gives each card only the
          // height its own padding+content needs; any leftover column
          // height simply stays empty below, which is the point.
          <div className="flex flex-col gap-4">
            <div className="rounded-3xl border border-border bg-card p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-muted-500">Runway In Use</div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="text-3xl font-semibold text-primary">{runwayStatusValue}</div>
                <div className="text-3xl font-semibold text-primary">{circuitDirectionValue}</div>
              </div>
            </div>
            {/* Beneath Runway In Use, above Airfield Info - NOTAMs are
                more time-sensitive than Airfield Info's static text (PPR
                hours etc.), so the more urgent thing sits higher.
                showAutoNotams preserves the toggle's existing meaning:
                ON shows this section when there's data, OFF shows
                nothing here regardless (manual Safety Notices in State B
                are unaffected by this flag either way). */}
            {showAutoNotams && visibleAutoNotams.length > 0 && (
              <div className="rounded-3xl border border-border bg-card p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">NOTAMs</div>
                <div className="mt-3 flex flex-col gap-2">
                  {visibleAutoNotams.map((notam) => (
                    <div key={notam.id} className="flex items-start gap-2 text-sm text-primary">
                      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT_CLASSES[notam.severity]}`} />
                      <span>{notam.text}</span>
                    </div>
                  ))}
                  {hiddenAutoNotamsCount > 0 && <div className="text-xs text-muted-500">+{hiddenAutoNotamsCount} more</div>}
                </div>
              </div>
            )}
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
