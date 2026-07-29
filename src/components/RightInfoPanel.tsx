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

// 'Left'/'Right' (not 'Left-hand'/'Right-hand') - condensed so
// "${label} circuit" fits on one line in the Runway In Use card's grid
// cell instead of wrapping to two, which was inflating that whole
// card's height (a shared grid row sizes to its tallest cell) and
// leaving visible empty space under the runway value's own single-line
// cell alongside it.
function circuitDirectionLabel(direction: string): string {
  return direction === 'right' ? 'Right' : 'Left'
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

// Empirically determined, not guessed: measured the real rendered
// height of the "Runway In Use"/auto-NOTAMs/Airfield Info stack at
// 1366x768 (the narrower of this app's two tested reference
// resolutions) with exactly MAX_AUTO_NOTAMS_SHOWN synthetic entries at
// increasing lengths - 121 characters was the longest that still fit
// without pushing the stack past the viewport; 122 already overflowed
// (a single additional wrapped line across all 3 entries costs ~45px
// at this width, more than the ~43px of margin available at 121). 110
// keeps a real safety margin below that exact breakpoint - the
// trailing ellipsis adds one more character, and font rendering can
// vary slightly by platform/browser, so sitting right at the measured
// edge would be fragile.
const AUTO_NOTAM_TRUNCATE_LENGTH = 110

interface TruncatedAutoNotam extends AutoNotam {
  wasTruncated: boolean
}

// Per-entry truncation - the first half of the overflow fix (task #43):
// no single NOTAM, however long, can blow out the compact card's
// height by itself. Whole-word-ish trim (trimEnd before the ellipsis)
// so it doesn't cut off mid-word looking like a rendering glitch.
function truncateAutoNotamText(notam: AutoNotam): TruncatedAutoNotam {
  if (notam.text.length <= AUTO_NOTAM_TRUNCATE_LENGTH) return { ...notam, wasTruncated: false }
  return { ...notam, text: `${notam.text.slice(0, AUTO_NOTAM_TRUNCATE_LENGTH).trimEnd()}…`, wasTruncated: true }
}

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

// Second half of the overflow fix (task #43) - a conditional 3rd
// rotation state, only ever entered when the compact state's own
// truncation/cap actually dropped something (see hasAutoNotamOverflow
// below). Shows every auto-NOTAM in full, untruncated text, so nothing
// is ever permanently hidden - just deferred to this state. Same
// dynamic scroll-height measurement as NotamsPanel above (copied, not
// abstracted into a shared helper - the two differ in exactly the bits
// that would make a shared abstraction more indirection than the
// duplication it'd save: different source data shape, different per-
// entry markup (a severity dot, not a size-keyed font class), no
// "notices can be managed from ATC Control" framing since these are
// read-only feed data). Same "no manual scrolling" guarantee too -
// overflow-hidden throughout, entries dropped and counted rather than
// made scrollable, zero viewer interaction required anywhere.
function AutoNotamsFullPanel({ notams }: { notams: AutoNotam[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(notams.length)

  useLayoutEffect(() => {
    setVisibleCount(notams.length)
  }, [notams])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || visibleCount <= 0) return
    if (el.scrollHeight > el.clientHeight) {
      setVisibleCount((count) => count - 1)
    }
  }, [visibleCount, notams])

  const hiddenCount = notams.length - visibleCount

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5">
      <div className="flex-shrink-0 text-xs uppercase tracking-[0.25em] text-muted-500">NOTAMs (full)</div>
      <div ref={containerRef} className="mt-3 min-h-0 flex-1 overflow-hidden">
        {notams.slice(0, visibleCount).map((notam) => (
          <div key={notam.id} className="mb-3 flex items-start gap-2 text-sm text-primary last:mb-0">
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT_CLASSES[notam.severity]}`} />
            <span>{notam.text}</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && <div className="flex-shrink-0 text-xs font-bold text-status-bad">+{hiddenCount} more</div>}
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

  // Derived from autoNotams (fetched above) - computed here, ahead of
  // the rotation-state effect below, specifically so that effect can
  // depend on hasAutoNotamOverflow directly. Capped to
  // MAX_AUTO_NOTAMS_SHOWN with a "+N more" indicator (unchanged), each
  // VISIBLE entry additionally per-entry truncated (task #43, part 1 -
  // see AUTO_NOTAM_TRUNCATE_LENGTH's own comment for how that limit was
  // measured). hasAutoNotamOverflow (part 2) is true when either the
  // cap hid whole entries, or truncation cut into any of the ones still
  // shown - either case means the compact state doesn't have this
  // tenant's complete NOTAM picture, which is exactly the condition
  // that should pull in the 3rd rotation state below.
  const sortedAutoNotams = [...(autoNotams ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const visibleAutoNotamsRaw = sortedAutoNotams.slice(0, MAX_AUTO_NOTAMS_SHOWN)
  const hiddenAutoNotamsCount = sortedAutoNotams.length - visibleAutoNotamsRaw.length
  const visibleAutoNotams = visibleAutoNotamsRaw.map(truncateAutoNotamText)
  const hasAutoNotamOverflow = hiddenAutoNotamsCount > 0 || visibleAutoNotams.some((n) => n.wasTruncated)

  // Carousel states, not a plain boolean flip anymore (task #43, part
  // 3) - 'notamsFull' (AutoNotamsFullPanel) is spliced in ONLY when
  // hasAutoNotamOverflow is true, so a tenant whose NOTAMs already fit
  // never wastes rotation time on a state with nothing new to show.
  // Still exactly one shared setInterval driving the whole rotation
  // (MediaPanel.tsx's own per-slot recursive setTimeout is a different
  // pattern for independently-durationed slots, not needed here - every
  // state shares the same notamsCarouselIntervalSeconds duration).
  const rotationStates: ('ops' | 'notamsFull' | 'notices')[] = [
    'ops',
    ...(hasAutoNotamOverflow ? (['notamsFull'] as const) : []),
    'notices',
  ]
  // Always starts on State A (today's default appearance) on load/on
  // any config refetch, then advances every notamsCarouselIntervalSeconds.
  // Read via `% rotationStates.length` at render time (not clamped
  // here) so a mid-cycle change in hasAutoNotamOverflow - e.g. new
  // NOTAM data arrives shrinking rotationStates from 3 states back to 2
  // - can never leave rotationIndex pointing past the end of the
  // (now shorter) array.
  const [rotationIndex, setRotationIndex] = useState(0)

  useEffect(() => {
    setRotationIndex(0)
    if (notamsOnly) return
    const intervalSeconds = opsPanel?.notamsCarouselIntervalSeconds ?? 5
    const id = window.setInterval(() => {
      setRotationIndex((value) => value + 1)
    }, Math.max(1, intervalSeconds) * 1000)
    return () => window.clearInterval(id)
  }, [notamsOnly, opsPanel?.notamsCarouselIntervalSeconds])

  const currentRotationState = rotationStates[rotationIndex % rotationStates.length]

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
  //
  // "Open" dropped from the runway value ("26 Open" -> "26") and
  // circuitDirectionLabel condensed to "Left"/"Right" (was "Left-hand"/
  // "Right-hand") - both now short enough to fit their own grid cell on
  // one line at this card's text-3xl size, which also fixes a real
  // layout bug: a wrapped "Left-hand circuit" was inflating the shared
  // grid row taller than the single-line runway value needed, leaving
  // visible empty space under that value. The "Runway In Use" label
  // itself already says everything "Open" was adding.
  const runwayStatusValue = opsPanel ? opsPanel.activeRunwayEnd : '08/26'
  const circuitDirectionValue = `${circuitDirectionLabel(opsPanel?.circuitDirection ?? 'left')} circuit`
  const cards = [...(airfieldInfoText ? [{ title: 'Airfield Info', value: airfieldInfoText }] : [])]

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
        {currentRotationState === 'notices' ? (
          <NotamsPanel notices={noticesForDisplay} />
        ) : currentRotationState === 'notamsFull' ? (
          <AutoNotamsFullPanel notams={sortedAutoNotams} />
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
              {/* flex, not grid-cols-2 (was an even 50/50 split) - a
                  2-character runway number doesn't need the same width
                  as "Left circuit"/"Right circuit", and giving it half
                  the row was exactly backwards: the runway number sat in
                  a mostly-empty column while circuit direction was
                  starved for room and wrapped. flex-shrink-0 sizes the
                  runway number to its own content only; the circuit
                  direction cell (flex-1) gets everything left over,
                  which is what actually needs the extra width. */}
              <div className="mt-3 flex items-center gap-4">
                <div className="flex-shrink-0 text-3xl font-semibold text-primary">{runwayStatusValue}</div>
                <div className="flex-1 text-3xl font-semibold text-primary">{circuitDirectionValue}</div>
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
