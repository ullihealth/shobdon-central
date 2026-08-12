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
  // Independent per-state durations (migration 0077), replacing the
  // single shared value above - ops = the Runway In Use/auto-NOTAMs/
  // Airfield Info cards, notamsFull = the full-text auto-NOTAM overflow
  // page, notices = the manual Safety Notices page. Optional (not
  // `number` like the field above) since a tenant that's never saved
  // through the new ops-panel PUT validation yet may still be on a
  // cached/pre-migration response shape - read with `?? 5` in the
  // rotation effect below either way.
  notamsOpsDurationSeconds?: number
  notamsFullDurationSeconds?: number
  noticesDurationSeconds?: number
  // ATC-triggered override (migration 0054) - when true, every render
  // location that shows activeRunwayEnd/circuitDirection shows
  // "RUNWAYS CLOSED" instead (see the Runway In Use card below).
  // Deliberately does NOT affect CompassPanel.tsx - wind/compass data
  // stays meaningful regardless of runway closure status, per explicit
  // instruction.
  runwaysClosed: boolean
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

// Carousel rotation state (dynamic NOTAM card restructure) - carries
// identity (cardIndex) rather than being a bare type tag, so the render
// branch can look up which of potentially many notamsFull cards is
// currently showing. See the main component's rotationStates comment
// for the full "why".
type RotationState = { type: 'ops' } | { type: 'notamsFull'; cardIndex: number }

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

// Restructure (see this file's own carousel comments further down):
// card 1 is now fixed/static (Runway In Use + Airfield Info + Notices,
// never NOTAM content), and NOTAMs live exclusively on however many
// dynamically-paginated "notamsFull" cards it takes to show all of
// them without truncation - so the old per-entry character truncation
// (AUTO_NOTAM_TRUNCATE_LENGTH/truncateAutoNotamText) and fixed 3-entry
// cap (MAX_AUTO_NOTAMS_SHOWN) this section used to need are gone
// entirely, replaced by NOTAM_CARD_CAP below (a cap on CARD count, not
// per-card entry count).
const NOTAM_CARD_CAP = 15

// Single measurement pass (not a drop-one/remeasure loop - see this
// file's own comment on NotamsPanel's identical single-pass fix for
// why that loop shape is a confirmed perf bug here) over EVERY NOTAM
// entry rendered at once into one hidden, unbounded-height container -
// walks cumulative offsetTop/offsetHeight and counts how many times
// content crosses another multiple of one real card's own clientHeight,
// i.e. how many cards greedy-packing would need. This count alone -
// not the greedy split itself - is what callers use; the actual
// entries-per-card grouping comes from chunkEvenly below instead, so a
// tenant with e.g. 6 NOTAMs that greedily fit 5-per-card still lands on
// 2 real cards, split ~3/3 rather than 5/1.
function computeNotamPageCount(container: HTMLDivElement, itemCount: number): number {
  if (itemCount === 0) return 0
  const cardHeight = container.clientHeight
  if (cardHeight <= 0) return 1

  let pages = 1
  let pageStartTop = 0
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (child.offsetTop + child.offsetHeight - pageStartTop > cardHeight) {
      pages += 1
      pageStartTop = child.offsetTop
    }
  }
  return Math.min(pages, NOTAM_CARD_CAP)
}

// Balanced redistribution (not greedy fill-then-sparse-remainder) -
// splits `items` into exactly `groupCount` groups whose sizes differ by
// at most one entry, by index range rather than by re-measuring each
// group's own rendered height. This is a deliberate simplification, not
// an oversight: AutoNotamsFullPanel's own existing per-card overflow
// protection (unchanged, reused as-is for every notamsFull card below)
// still runs on whatever group it's given, so an unusually
// content-heavy redistributed group that doesn't quite fit its card
// still self-corrects at render time via that existing "+N more"
// mechanism, exactly like it always has - this function only needs to
// get card COUNT and rough balance right, not guarantee every group
// individually fits.
function chunkEvenly<T>(items: T[], groupCount: number): T[][] {
  if (groupCount <= 0 || items.length === 0) return []
  const groups: T[][] = []
  for (let i = 0; i < groupCount; i++) {
    const start = Math.floor((i * items.length) / groupCount)
    const end = Math.floor(((i + 1) * items.length) / groupCount)
    groups.push(items.slice(start, end))
  }
  return groups
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

// Renders the manual Safety Notices list - each notice as its own block, blank-line-separated,
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
//
// compact (default false, the notamsOnly/Clubhouse2Template usage is
// completely unaffected either way) - card 1 of the restructured OPS
// Panel carousel passes true. Investigated after manual review flagged
// Notices rendering empty and jumping straight to "+N more": the flex
// chain from card 1's root down to this component's own containerRef
// is intact and DOES pass down a real, correctly-computed height (
// confirmed via getBoundingClientRect/computed-style inspection, not
// assumed) - the actual cause is that this card's own chrome (p-5
// padding, text-base title, mt-3 gap, mb-4 between entries) was sized
// for when this component filled an ENTIRE rotation-state card on its
// own (200-400px+ typical), and now only gets a fraction of card 1
// alongside Runway In Use/Airfield Info (routinely under 160px total,
// ~80px of actual content area) - at that size, this panel's own fixed
// overhead was eating most of the available space before any notice
// text was even measured, so real (if modest) admin-entered notices
// legitimately didn't fit even one entry. compact tightens exactly
// that fixed overhead (padding/title/margins), not notice font size
// itself (SIZE_CLASSES, an admin-chosen setting, is unchanged) -
// reclaims real content height so genuinely-sized notices have a
// realistic chance of showing at least one entry before truncating.
function NotamsPanel({ notices, compact = false }: { notices: SafetyNotice[]; compact?: boolean }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const indicatorMeasureRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(notices.length)

  useLayoutEffect(() => {
    setVisibleCount(notices.length)
  }, [notices])

  // Single-pass measurement, replacing an earlier "drop one entry,
  // re-render, remeasure scrollHeight, repeat" loop - that could force up
  // to notices.length synchronous layout passes per render, on this
  // panel's own 5-second rotation cadence (RightInfoPanel's ops/
  // notamsFull/notices state cycle) - confirmed as the cause of a
  // periodic desktop-only footer-ticker stutter (mobile's equivalent,
  // AutoNotamsScrollPanel.tsx, has no such loop and shows no stutter).
  // This only runs once per `notices` change, against the full-length
  // render it just reset to above: walks each already-rendered item's own
  // offsetTop/offsetHeight (already reflects wrapping/margins exactly
  // like the old scrollHeight check did) and finds, in one forward pass,
  // the largest prefix that fits - then sets visibleCount directly, a
  // single corrective re-render instead of up to N of them.
  //
  // The "+N more" indicator is a flex-shrink-0 SIBLING of containerRef
  // (below), not a child of it - showing it shrinks containerRef's own
  // available height via their shared flex-col parent. Measured here via
  // an always-present, invisible, absolutely-positioned copy of the same
  // text (rendered only while hiddenCount is 0, i.e. exactly the window
  // this effect cares about) and subtracted from containerRef's current
  // clientHeight up front, rather than needing a second remeasurement
  // pass after truncation is actually applied.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || notices.length === 0 || visibleCount !== notices.length) return
    if (el.scrollHeight <= el.clientHeight) return

    const indicatorHeight = indicatorMeasureRef.current?.offsetHeight ?? 0
    const available = el.clientHeight - indicatorHeight
    let fitCount = 0
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child.offsetTop + child.offsetHeight > available) break
      fitCount += 1
    }
    setVisibleCount(fitCount)
  }, [visibleCount, notices])

  const hiddenCount = notices.length - visibleCount

  return (
    <div className={`relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card ${compact ? 'p-3' : 'p-5'}`}>
      {/* Header text is "NOTICES" (was "NOTAMS") - this panel has
          rendered manual admin-entered Safety Notices, not automated
          NOTAMs, for a while now (see the surrounding comment above);
          that mislabeling only became directly visible to end users
          once NOTAMs and Notices were split onto genuinely separate
          cards by the restructure - previously this title never shared
          a rotation with a REAL "NOTAMs (full)" card to be confused
          against. text-xs in compact mode (was always text-base) -
          part of reclaiming card 1's fixed chrome overhead, see this
          component's own compact comment above. */}
      <div
        className={`flex-shrink-0 text-center uppercase tracking-[0.25em] text-muted-500 ${compact ? 'text-xs' : 'text-base'}`}
      >
        NOTICES
      </div>
      {/* relative - so the mapped items' own offsetTop below is measured
          from THIS element's top edge (matching el.clientHeight's own
          origin), not from some further-up positioned ancestor. */}
      <div className={`relative min-h-0 flex-1 overflow-hidden ${compact ? 'mt-1' : 'mt-3'}`} ref={containerRef}>
        {notices.slice(0, visibleCount).map((notice, index) => (
          <div
            key={index}
            className={`${compact ? 'mb-2' : 'mb-4'} font-semibold text-primary last:mb-0 ${SIZE_CLASSES[notice.size]}`}
          >
            {notice.text}
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className={`flex-shrink-0 font-bold text-status-bad ${compact ? 'text-sm' : 'text-lg'}`}>
          +{hiddenCount} more — see /atc-control
        </div>
      )}
      {hiddenCount === 0 && notices.length > 0 && (
        <div
          ref={indicatorMeasureRef}
          className={`invisible absolute left-0 top-0 font-bold ${compact ? 'text-sm' : 'text-lg'}`}
          aria-hidden="true"
        >
          +{notices.length} more — see /atc-control
        </div>
      )}
    </div>
  )
}

// Renders ONE NOTAM card's worth of entries, in full, untruncated text -
// reused unmodified across however many dynamic NOTAM cards the
// restructure's pagination produces (see NotamMeasurementPass/
// computeNotamPageCount/chunkEvenly further down): each call gets its
// own pre-computed slice of the full NOTAM set, not the whole thing.
// Its own dynamic scroll-height measurement below is still real, useful
// work even though entries are already pre-paginated to roughly fit -
// balanced redistribution groups by entry COUNT, not remeasured height
// (see chunkEvenly's own comment), so this is the per-card safety net
// that quietly self-corrects (drops entries, shows "+N more") if a
// particular group still doesn't fit its box. Same dynamic scroll-height
// measurement as NotamsPanel above (copied, not abstracted into a shared
// helper - the two differ in exactly the bits that would make a shared
// abstraction more indirection than the duplication it'd save: different
// source data shape, different per-entry markup (a severity dot, not a
// size-keyed font class), no "notices can be managed from ATC Control"
// framing since these are read-only feed data). Same "no manual
// scrolling" guarantee too - overflow-hidden throughout, entries dropped
// and counted rather than made scrollable, zero viewer interaction
// required anywhere.
function AutoNotamsFullPanel({ notams }: { notams: AutoNotam[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const indicatorMeasureRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(notams.length)

  useLayoutEffect(() => {
    setVisibleCount(notams.length)
  }, [notams])

  // Single-pass measurement - same fix, same reasoning as NotamsPanel's
  // identical comment above (kept as a separate copy per this file's own
  // existing "not abstracted, differs in exactly the bits that matter"
  // convention for these two panels).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || notams.length === 0 || visibleCount !== notams.length) return
    if (el.scrollHeight <= el.clientHeight) return

    const indicatorHeight = indicatorMeasureRef.current?.offsetHeight ?? 0
    const available = el.clientHeight - indicatorHeight
    let fitCount = 0
    for (const child of Array.from(el.children) as HTMLElement[]) {
      if (child.offsetTop + child.offsetHeight > available) break
      fitCount += 1
    }
    setVisibleCount(fitCount)
  }, [visibleCount, notams])

  const hiddenCount = notams.length - visibleCount

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5">
      <div className="flex-shrink-0 text-center text-base uppercase tracking-[0.25em] text-muted-500">NOTAMs (full)</div>
      <div ref={containerRef} className="relative mt-3 min-h-0 flex-1 overflow-hidden">
        {notams.slice(0, visibleCount).map((notam) => (
          <div key={notam.id} className="mb-3 flex items-start gap-2 text-[15px] text-primary last:mb-0">
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT_CLASSES[notam.severity]}`} />
            <span>{notam.text}</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && <div className="flex-shrink-0 text-xs font-bold text-status-bad">+{hiddenCount} more</div>}
      {hiddenCount === 0 && notams.length > 0 && (
        <div ref={indicatorMeasureRef} className="invisible absolute left-0 top-0 text-xs font-bold" aria-hidden="true">
          +{notams.length} more
        </div>
      )}
    </div>
  )
}

// Hidden pre-render measurement pass (dynamic NOTAM card restructure) -
// structurally an exact twin of AutoNotamsFullPanel above (same outer
// classes, same per-entry markup) so per-entry heights measure
// identically to how they'll actually render, rendered by the caller
// into the REAL grid cell the visible carousel occupies
// (`visibility: hidden`, not `display: none` - the latter collapses
// dimensions to 0 and every entry would incorrectly measure as fitting)
// so containerRef's clientHeight below genuinely equals one real card's
// available content height, not a guessed/tracked-separately value.
// Renders every NOTAM at once (not sliced) specifically so this single
// layout effect can walk the whole set in one pass - see
// computeNotamPageCount's own comment for why this doesn't reintroduce
// the drop-one/remeasure loop this file already ruled out elsewhere.
// No font-loading wait (e.g. document.fonts.ready) here, deliberately -
// NotamsPanel/AutoNotamsFullPanel's own equivalent effects don't do
// this either, so this matches their existing risk profile rather than
// solving a problem neither of them has addressed.
function NotamMeasurementPass({
  notams,
  onMeasured,
}: {
  notams: AutoNotam[]
  onMeasured: (groups: AutoNotam[][]) => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const pageCount = computeNotamPageCount(el, notams.length)
    onMeasured(chunkEvenly(notams, pageCount))
    // onMeasured is a fresh closure every render (setNotamCardGroups
    // wrapped inline by the caller) - depending on `notams` alone here
    // (not onMeasured) is deliberate, matching this file's existing
    // convention (e.g. NotamsPanel's own notices-keyed effects) of
    // keying remeasurement on the actual DATA changing, not on a
    // same-render callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notams])

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5">
      <div className="flex-shrink-0 text-center text-base uppercase tracking-[0.25em] text-muted-500">NOTAMs (full)</div>
      <div ref={containerRef} className="relative mt-3 min-h-0 flex-1 overflow-hidden">
        {notams.map((notam) => (
          <div key={notam.id} className="mb-3 flex items-start gap-2 text-[15px] text-primary last:mb-0">
            <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT_CLASSES[notam.severity]}`} />
            <span>{notam.text}</span>
          </div>
        ))}
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

  // Derived from autoNotams (fetched above) - full set, untruncated,
  // severity-sorted. Distribution across dynamic NOTAM cards (below)
  // happens against this same array; showAutoNotams gates it down to
  // an empty list rather than filtering after the fact, so a tenant
  // with the toggle off never triggers the measurement pass at all.
  const sortedAutoNotams = [...(autoNotams ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const notamsForPagination = (opsPanel?.showAutoNotams ?? true) ? sortedAutoNotams : []

  // Restructure: card 1 (Runway In Use/Airfield Info/Notices) is now
  // fixed/static and never carries NOTAM content, so there's nothing
  // left to measure there - all NOTAMs instead paginate across however
  // many "notamsFull" cards it takes (NotamMeasurementPass below,
  // rendered hidden in the real grid cell). null = not yet measured for
  // the current notamsForPagination set (either still loading, or the
  // hidden pass hasn't committed a result yet); [] = measured, zero
  // NOTAM cards needed. Reset to null whenever the underlying NOTAM
  // data changes so a remeasure runs - in practice today autoNotams
  // only ever resolves once per mount (no polling refetch), so this is
  // a one-time transition, but keying off the data rather than mount
  // timing keeps this correct if that ever changes.
  const [notamCardGroups, setNotamCardGroups] = useState<AutoNotam[][] | null>(null)
  useEffect(() => {
    setNotamCardGroups(null)
  }, [autoNotams])

  const measurementPending = notamsForPagination.length > 0 && notamCardGroups === null

  // Carousel states now carry identity (cardIndex), not just a type tag
  // - a bare 'notamsFull' string could only ever mean "the one NOTAMs
  // card", which stops working the moment there can be more than one.
  // 'notices' is gone entirely as its own state - Notices is part of
  // the single fixed 'ops' card now (see the render branch below).
  const rotationStates: RotationState[] = [
    { type: 'ops' },
    ...(notamCardGroups ?? []).map((_, cardIndex) => ({ type: 'notamsFull' as const, cardIndex })),
  ]
  // Ref mirroring the latest rotationStates array, read inside the
  // recursive-timeout effect below instead of closing over the array
  // directly - see that effect's own comment for why rotationStates.length
  // (unlike the old hasAutoNotamOverflow boolean it replaced) IS a real
  // dependency there now, but scheduleNext still needs the ref rather
  // than a closed-over array so it always resolves against whatever's
  // actually being rendered right now, not a stale snapshot from
  // whenever the effect last (re)ran.
  const rotationStatesRef = useRef(rotationStates)
  rotationStatesRef.current = rotationStates

  // Always starts on State A (today's default appearance) on load/on
  // any config refetch, then advances via the recursive setTimeout
  // below - each state now reads its own independent duration
  // (notamsOpsDurationSeconds/notamsFullDurationSeconds, migration
  // 0077) rather than one shared interval, matching LeftInfoPanel.tsx's
  // own Summary/Chart flip (see that file's equivalent effect).
  // noticesDurationSeconds is no longer read here - Notices has no
  // standalone rotation state anymore (folded into 'ops', see above) -
  // left in place/unused in ops_panel_state itself, same posture this
  // file already takes with notamsCarouselIntervalSeconds elsewhere.
  const [rotationIndex, setRotationIndex] = useState(0)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.clearTimeout(timerRef.current)
    setRotationIndex(0)
    if (notamsOnly) return
    // Genuinely nothing to rotate to yet (measurement pending, zero
    // NOTAMs, or the toggle is off) - mirrors notamsOnly's own
    // early-return above rather than starting a timer that would just
    // flip state 0 back to state 0 forever. This is also what makes
    // the transition below actually happen: rotationStates.length is a
    // real dependency of this effect specifically so it re-runs (and
    // this guard re-evaluates) the moment measurement completes and
    // length grows past 1 - without it the timer would never start at
    // all, having already returned early on the first, pre-measurement
    // render.
    if (rotationStates.length <= 1) return

    let index = 0
    const scheduleNext = () => {
      const states = rotationStatesRef.current
      const state = states[index % states.length]
      const seconds =
        state.type === 'ops' ? (opsPanel?.notamsOpsDurationSeconds ?? 5) : (opsPanel?.notamsFullDurationSeconds ?? 5)
      timerRef.current = window.setTimeout(() => {
        index += 1
        setRotationIndex(index)
        scheduleNext()
      }, Math.max(1, seconds) * 1000)
    }
    scheduleNext()

    return () => window.clearTimeout(timerRef.current)
  }, [notamsOnly, rotationStates.length, opsPanel?.notamsOpsDurationSeconds, opsPanel?.notamsFullDurationSeconds])

  const currentRotationState = rotationStates[rotationIndex % rotationStates.length]

  // enabled === false explicitly excludes a row from display entirely
  // (not greyed out, not counted toward "+N more" - simply absent from
  // the array NotamsPanel ever sees). !== false rather than === true so
  // a missing/undefined field (shouldn't happen post-migration, but
  // defensive against any stale/unexpected data) defaults to shown,
  // matching the migration's own enabled=true default.
  const manualNotices = (opsPanel?.safetyNotices ?? []).filter((n) => n.enabled !== false)
  // 'N/A' as a single block preserves the exact prior informational
  // behaviour (weather/mock-fallback uncertainty overrides even real
  // manual notices) while fitting NotamsPanel's own one-block-per-entry shape.
  const noticesForDisplay: SafetyNotice[] =
    !weather || liveDataUnavailable
      ? [{ text: 'N/A', size: 'md', enabled: true }]
      : manualNotices.length > 0
        ? manualNotices
        : [{ text: 'No active notices', size: 'md', enabled: true }]

  // Runway Status and Circuit Direction come from ops_panel_state (set
  // via /atc-control); a null opsPanel (no /atc-control usage yet on
  // this tenant) falls back to the same static defaults this file used
  // to hardcode, rather than showing blank cards. NOTAM content never
  // appears on this card at all (restructure) - it's exclusively on the
  // dynamic notamsFull cards below.
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
      <div className="mb-5 flex-shrink-0 text-center text-lg font-semibold uppercase tracking-[0.25em] text-muted-400">
        Ops Panel
      </div>
      {/* relative - anchors the hidden measurement pass's absolute
          inset-0 box below to THIS element's real, laid-out size (Option
          A from the investigation: same ancestor chain/computed
          width+height as the real card slot, not a separately-tracked
          copy of them). */}
      <div className="relative min-h-0 flex-1">
        {/* Hidden pre-render measurement pass - mounted only while a
            measurement is actually owed (real NOTAM data exists but
            hasn't been paginated yet). visibility: hidden keeps this in
            layout (so containerRef inside it gets a real clientHeight)
            without painting or affecting the visible content stacked in
            the same slot below; display:none would collapse it to zero
            height and silently report everything fitting on one card. */}
        {measurementPending && (
          <div className="absolute inset-0" style={{ visibility: 'hidden' }} aria-hidden="true">
            <NotamMeasurementPass notams={notamsForPagination} onMeasured={setNotamCardGroups} />
          </div>
        )}
        {currentRotationState.type === 'notamsFull' ? (
          <AutoNotamsFullPanel notams={notamCardGroups?.[currentRotationState.cardIndex] ?? []} />
        ) : (
          // Card 1 (fixed/static, never NOTAM content) - Runway In Use
          // and Airfield Info are flex-shrink-0 (content-sized, as
          // before); Notices is the one variable-length piece here, so
          // it's the one wrapped in flex-1 min-h-0 - that's what gives
          // NotamsPanel's own containerRef a genuine BOUNDED clientHeight
          // to measure against (its overflow/"+N more" check is a no-op
          // against a content-sized, unbounded box - scrollHeight would
          // never exceed clientHeight if clientHeight just grows to fit).
          // The outer h-full (new - the old three-cards-content-sized
          // stack didn't need it, since nothing here used to need
          // leftover space) is what makes that flex-1 have any real
          // height to claim in the first place.
          //
          // gap-3/p-4/mt-2 here (was gap-4/p-5/mt-3) - investigated after
          // manual review found Notices rendering empty ("+N more" with
          // zero entries shown). Confirmed via computed-style inspection
          // that the flex chain down to NotamsPanel is intact and DOES
          // pass a real, correctly-computed height - Runway In Use/
          // Airfield Info were already right where Jeff's own original
          // sizing estimate put them (~20-25% of card 1 each), not
          // bloated. The actual cause: combining three cards into the
          // space one card (NotamsPanel, at full size) used to have
          // alone left Notices with materially less room than before,
          // and real admin-entered notices at this component's larger
          // SIZE_CLASSES tiers routinely need more vertical space than
          // that remainder had. This tightening (here) plus
          // NotamsPanel's own `compact` mode (see that component's
          // comment) together reclaim real, meaningful height rather
          // than papering over the symptom - Runway In Use/Airfield
          // Info's OWN single-line values don't need p-5/mt-3's full
          // breathing room to stay readable.
          <div className="flex h-full flex-col gap-3">
            <div className="flex-shrink-0 rounded-3xl border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-muted-500">Runway In Use</div>
              {opsPanel?.runwaysClosed ? (
                // ATC override (migration 0054) - supersedes both values
                // below as one combined message, not two separately-red
                // cells: a circuit direction has no operational meaning
                // for a closed runway. activeRunwayEnd/circuitDirection
                // stay set underneath (see AtcControlPage.tsx's toggle
                // comment), so this is purely a display swap.
                <div className="mt-2 text-3xl font-semibold text-status-bad">RUNWAYS CLOSED</div>
              ) : (
                // flex, not grid-cols-2 (was an even 50/50 split) - a
                // 2-character runway number doesn't need the same width
                // as "Left circuit"/"Right circuit", and giving it half
                // the row was exactly backwards: the runway number sat in
                // a mostly-empty column while circuit direction was
                // starved for room and wrapped. flex-shrink-0 sizes the
                // runway number to its own content only; the circuit
                // direction cell (flex-1) gets everything left over,
                // which is what actually needs the extra width.
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex-shrink-0 text-3xl font-semibold text-primary">{runwayStatusValue}</div>
                  <div className="flex-1 text-3xl font-semibold text-primary">{circuitDirectionValue}</div>
                </div>
              )}
            </div>
            {cards.map((card) => (
              <div key={card.title} className="flex-shrink-0 rounded-3xl border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{card.title}</div>
                <div className="mt-2 text-3xl font-semibold text-primary">{card.value}</div>
              </div>
            ))}
            <div className="min-h-0 flex-1">
              <NotamsPanel notices={noticesForDisplay} compact />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
