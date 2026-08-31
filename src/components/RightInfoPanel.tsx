import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useWeather } from '../context/WeatherContext'
import { NOTAMS_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'

// Standalone QR rotation card (Ops Panel's internal carousel) - flip to
// false to pull the card out of rotation entirely (omitted from
// rotationStates below, not just hidden) with no rebuilding. The small
// Runway In Use/Circuit square's own paused QR-vs-CIRCUIT-text toggle
// (formerly a separate QR_ENABLED flag) was removed once this full-
// height slide fully superseded it - that square now always shows
// circuit direction, unconditionally.
const QR_CARD_ENABLED = true

// Same value/name as PilotViewPage.tsx's own REFRESH_INTERVAL_MS - not
// imported from there (that file has no shared exports, and this
// component is a different, desktop-side self-fetch entirely) but
// deliberately the same 60s cadence for consistency across desktop/
// /pilot, per the runway-direction staleness fix (see this file's own
// refreshTick comment below).
const REFRESH_INTERVAL_MS = 60_000

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
// for the full "why". 'qr' added for the standalone Pilot App QR
// rotation card - a single fixed entry, same shape as 'ops', not a
// per-instance identity like 'notamsFull' needs.
type RotationState = { type: 'ops' } | { type: 'qr' } | { type: 'notamsFull'; cardIndex: number }

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

// Pilot App QR sizing (dynamic NOTAM restructure's follow-on round) -
// replaces the old fixed 1600px viewport-width breakpoint entirely.
// window.innerWidth is CSS pixel width, not physical size - a 1920x1080
// 43in TV and a 1920x1080 24in monitor report identically, but the QR
// needs to be nearly double the physical size on the TV to stay
// reliably scannable from a few feet away. There's no browser API for a
// screen's real physical size, so it comes from tenants.display_width_cm
// (migration 0088, developer-set per tenant, see DeveloperToolsPage.tsx's
// DisplayWidthField) - null (not yet confirmed for this tenant) falls
// back to DISPLAY_WIDTH_FALLBACK_CM with a dev-mode console.warn, so a
// missing value is never silently wrong, just visibly assumed.
//
// pxPerCm = window.innerWidth / displayWidthCm, targetQrSizePx = 9 * that
// (9cm - the middle of the 8-10cm reliable-scan range from the original
// investigation). Clamped against the row's REAL measured available
// space (both width - so Runway In Use never gets squeezed below a
// readable minimum - and height - so Notices never loses the minimum
// space it needs, the exact regression the old 1600px gate existed to
// prevent) rather than hidden below a fixed breakpoint - a tenant on a
// genuinely small display now gets the largest QR that actually fits,
// always visible, instead of no QR at all below an arbitrary cutoff.
// Still logs a dev-mode warning if even that clamped size can't reach
// MIN_RELIABLE_QR_CM - visibility into a real constraint, not silent
// under-sizing.
const DISPLAY_WIDTH_FALLBACK_CM = 110
const TARGET_QR_CM = 9
const MIN_RELIABLE_QR_CM = 6
// Empirically measured (real Playwright diagnostic, previous round): at
// 1366x768 a Notices WRAPPER height of 157px was exactly what let
// NotamsPanel's own compact mode fit one real entry + "+N more" rather
// than truncating to zero (the bug that round fixed). Verified against
// the same number here rather than re-guessing - an earlier draft of
// this constant used ~96px (a rough content-area-only estimate) and
// measurably under-protected Notices at this exact viewport, reproducing
// the zero-entries regression the QR row's added height risks.
const MIN_NOTICES_HEIGHT_PX = 157
const ROW_GAP_PX = 12 // gap-3
// Matched-square restyle - Runway In Use and the QR card are now equal
// squares, each with its own label caption BELOW (not inside) the
// square, so the two constants below replace the old asymmetric-row
// chrome constants (MIN_RUNWAY_CARD_WIDTH_PX/QR_CARD_HORIZONTAL_CHROME_PX/
// QR_CARD_VERTICAL_CHROME_PX) entirely rather than extending them - that
// old math assumed Runway In Use filled the row's remaining width as a
// rectangle, which no longer describes this layout at all.
//
// QR_QUIET_MARGIN_PX - the small dark-bg-card strip between the square's
// outer edge and the white QR background (requirement: visible/
// intentional, not a hairline, and the white area must never touch the
// square's outer edge). Applied on all 4 sides, so it costs 2x in both
// the width and height budgets below. Bumped from an initial 6px to 10px
// after visual review asked for more breathing room on all sides, not
// just one edge - the QR itself shrinks a little as a direct result
// (see computeQrSizePx's own real measured trade-off, reported at the
// time this was raised).
const QR_QUIET_MARGIN_PX = 10
// CAPTION_ROW_HEIGHT_PX - "RUNWAY"/"PILOTS APP" now live outside their
// squares, as one shared caption row beneath both (mt-1 + a single line
// of text-[9px] tracking-[0.2em] uppercase) - a real, if small, height
// cost the row's total footprint still has to account for, subtracted
// once (not per-card - both captions sit in the same horizontal strip).
const CAPTION_ROW_HEIGHT_PX = 20
const QR_SIZE_FLOOR_PX = 40

// "Dev mode" for these warnings' purposes, deliberately broader than
// bare import.meta.env.DEV - this whole app is developed/reviewed as a
// `vite build` served by `wrangler pages dev` (this session's own
// established convention, every round), never `vite dev`, so
// import.meta.env.DEV alone is FALSE in every real local-review session
// and these warnings would never fire where they're most needed. Same
// "localhost/pages.dev preview = not real production" signal
// resolveTenantHost.ts's own PAGES_PREVIEW_SUFFIX check already uses
// server-side, reimplemented here for the client since functions/ and
// src/ are separate builds with no shared import path.
function shouldLogQrSizingWarnings(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host.endsWith('.pages.dev')
}

function computeQrSizePx(params: {
  windowWidthPx: number
  displayWidthCm: number | null
  card1HeightPx: number
  rowWidthPx: number
  airfieldInfoHeightPx: number
}): number {
  const { windowWidthPx, displayWidthCm, card1HeightPx, rowWidthPx, airfieldInfoHeightPx } = params

  const effectiveDisplayWidthCm = displayWidthCm ?? DISPLAY_WIDTH_FALLBACK_CM
  if (displayWidthCm === null && shouldLogQrSizingWarnings()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[RightInfoPanel] tenants.display_width_cm is not set - assuming ${DISPLAY_WIDTH_FALLBACK_CM}cm (~43in) for the Runway In Use/Circuit matched-square sizing. Set it in /developertools for an accurate physical size.`
    )
  }

  const pxPerCm = windowWidthPx / effectiveDisplayWidthCm
  const targetQrSizePx = TARGET_QR_CM * pxPerCm

  // Height constraint - how big can the (now square) card get before
  // Notices, sharing card 1's total height below the shared caption row,
  // drops under its own minimum.
  const maxSquareFromHeight = card1HeightPx - airfieldInfoHeightPx - 2 * ROW_GAP_PX - MIN_NOTICES_HEIGHT_PX - CAPTION_ROW_HEIGHT_PX

  // Width constraint - two EQUAL squares now share the row (matched-
  // square restyle), so each gets at most half the row's width minus the
  // gap between them - not "whatever Runway In Use doesn't need," which
  // no longer applies now that Runway In Use is forced to match the QR
  // square's size exactly rather than filling remaining space.
  const maxSquareFromWidth = (rowWidthPx - ROW_GAP_PX) / 2

  const maxSquareSize = Math.min(maxSquareFromHeight, maxSquareFromWidth)
  // The square has to hold the QR SVG plus its own quiet margin on both
  // sides - back that out to get the SVG's own actual max size.
  const maxQrSizeFromSquare = maxSquareSize - 2 * QR_QUIET_MARGIN_PX

  const clamped = Math.min(targetQrSizePx, maxQrSizeFromSquare)
  const finalSize = Math.max(QR_SIZE_FLOOR_PX, Math.floor(clamped))

  // MIN_RELIABLE_QR_CM is a holdover threshold name from when this
  // function sized an actual rendered QR (see this file's own history -
  // the small square's QR was removed once the standalone full-height
  // QR slide superseded it). Still a meaningful, real floor to warn
  // against here: it's the same physical-size tuning this square's
  // Runway/Circuit text sizing inherited, just no longer about scan
  // reliability specifically.
  if (finalSize / pxPerCm < MIN_RELIABLE_QR_CM && shouldLogQrSizingWarnings()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[RightInfoPanel] Runway In Use/Circuit matched-square size clamped to ${(finalSize / pxPerCm).toFixed(1)}cm to protect Notices' available space - under the ${MIN_RELIABLE_QR_CM}cm floor these squares were originally tuned against. Consider a taller/wider Ops Panel column or confirming display_width_cm is accurate for this tenant.`
    )
  }

  return finalSize
}

// Standalone Pilot App QR rotation card - deliberately its own fixed
// duration, not a reuse of notamsFullDurationSeconds (that field is
// semantically "NOTAMs," and reusing it would tie QR screen time to a
// setting an admin thinks only controls NOTAM display). Hardcoded for
// now rather than a new tenant-configurable column/migration - can
// become one later without disturbing anything else here. 10s, not the
// 5s other cards default to: a QR needs meaningfully more than a
// glance-and-read duration for a genuine "notice it, get phone out,
// open camera, scan" cold-start flow - 10s (2x the other cards'
// default) is a round, easy-to-explain floor without disproportionately
// stretching the total cycle at high NOTAM counts.
const QR_CARD_DURATION_SECONDS = 10

// QR sizing for the standalone slide's bottom strip (Ops Panel's
// internal rotation, 'qr' state) - deliberately NOT computeQrSizePx
// above (that solves the small 177x177px Runway In Use/Circuit-square
// problem) NOR the original centered full-card version this replaced
// (see git history - that filled most of the card; this slide now
// dedicates its top ~80% to a phone mockup image instead, leaving only
// a bottom strip, shared with the caption, for the QR). Same
// display_width_cm plumbing reused verbatim - still a genuine physical-
// screen fact, unrelated to which box the QR sits in.
//
// Sized top-down from the physical cm target (same shape as
// computeFullCardQrSizePx), NOT from a CSS-fixed square measured via
// ref - an earlier version of this function tried "give the outer box
// a fixed Tailwind h-20/sm:h-24 aspect-square size via CSS, then fit
// the QR inside whatever that measures to" and hit two real problems:
// (1) a Tailwind h-* + aspect-square item inside a flex ROW can have
// its cross-axis (height) compressed by the browser's aspect-ratio/
// flex-shrink interaction even with flex-shrink-0 set, confirmed via
// Playwright - it measured 72px at 1366px width instead of the
// intended 96px; (2) even at the sizes that DID apply, a fixed ~96px
// box physically cannot fit a 6cm QR at any normal display_width_cm
// (measured 4.8-4.9cm, under the 6cm floor, purely from the box being
// too small - nothing to do with the cm math itself). Computing the
// outer square's own pixel size FROM the cm target first (clamped only
// against a sane share of the card's total height, not an arbitrary
// fixed token) fixes both at once.
const QR_STRIP_TARGET_CM = 6
const QR_STRIP_QUIET_MARGIN_PX = 6
const QR_STRIP_SIZE_FLOOR_PX = 60
// Bottom strip's own height is capped at ~28% of the full card height
// (spec calls for a "~20-25%" strip) - a little headroom above 25% so
// the strip can still hit QR_STRIP_TARGET_CM on shorter viewports
// before falling back to this cap, without letting the strip balloon
// past what still reads as "top image zone dominates."
const QR_STRIP_MAX_HEIGHT_SHARE = 0.28

function computeQrStripSquarePx(params: { windowWidthPx: number; displayWidthCm: number | null; cardHeightPx: number }): number {
  const { windowWidthPx, displayWidthCm, cardHeightPx } = params

  const effectiveDisplayWidthCm = displayWidthCm ?? DISPLAY_WIDTH_FALLBACK_CM
  if (displayWidthCm === null && shouldLogQrSizingWarnings()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[RightInfoPanel] tenants.display_width_cm is not set - assuming ${DISPLAY_WIDTH_FALLBACK_CM}cm (~43in) for the standalone Pilot App QR strip. Set it in /developertools for an accurate physical size.`
    )
  }

  const pxPerCm = windowWidthPx / effectiveDisplayWidthCm
  const targetSquarePx = QR_STRIP_TARGET_CM * pxPerCm + 2 * QR_STRIP_QUIET_MARGIN_PX

  const maxFromCard = cardHeightPx * QR_STRIP_MAX_HEIGHT_SHARE

  // Math.ceil, not floor - flooring the OUTER square (which still has
  // the quiet margin subtracted off afterwards for the actual QR SVG
  // size) was rounding the achieved cm size down to just under the 6cm
  // target/floor (5.96cm measured, not 6.0cm) - confirmed via
  // Playwright. Ceil keeps the achieved size at-or-just-above the
  // target instead of a rounding-driven undershoot.
  const clamped = Math.min(targetSquarePx, maxFromCard)
  const finalSize = Math.max(QR_STRIP_SIZE_FLOOR_PX + 2 * QR_STRIP_QUIET_MARGIN_PX, Math.ceil(clamped))
  const finalQrPx = finalSize - 2 * QR_STRIP_QUIET_MARGIN_PX

  if (finalQrPx / pxPerCm < MIN_RELIABLE_QR_CM && shouldLogQrSizingWarnings()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[RightInfoPanel] Standalone Pilot App QR strip clamped to ${(finalQrPx / pxPerCm).toFixed(1)}cm - under the ${MIN_RELIABLE_QR_CM}cm reliable-scan floor. Showing it anyway rather than hiding it; this would only fire on a genuinely short Ops Panel column or an inaccurate display_width_cm.`
    )
  }

  // Returns the OUTER white square's px size (quiet margin included) -
  // callers derive the QR SVG's own size as size - 2*QR_STRIP_QUIET_MARGIN_PX.
  return finalSize
}

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
          a rotation with a REAL "NATS NOTAMs (full)" card to be confused
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
      <div className="flex-shrink-0 text-center text-base uppercase tracking-[0.25em] text-muted-500">NATS NOTAMs (full)</div>
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
      <div className="flex-shrink-0 text-center text-base uppercase tracking-[0.25em] text-muted-500">NATS NOTAMs (full)</div>
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

// Standalone Pilot App QR rotation card - one of RightInfoPanel's own
// rotation states (see rotationStates below). Now renders full COLUMN
// height (not just the card footprint AutoNotamsFullPanel gets) while
// this slide is showing - see onQrSlideChange/RightInfoPanelProps'
// own comment and Clubhouse1Template.tsx for the sibling
// (GasPricesPanel) hide/show half of that mechanism; this component
// itself doesn't know or care that its parent column happens to be
// taller during its own mount, it just fills h-full same as always.
//
// Layout: top zone (flex-1, the phone mockup image, proportion
// governed entirely by the QR strip's own fixed height below claiming
// the rest - no explicit 75/80% split coded anywhere, letting flex-1
// naturally absorb "however much is left" keeps this correct at both
// tested viewports without two separate hardcoded percentages that
// could drift out of sync) + bottom strip (fixed-height row, caption
// left/QR right).
//
// QR sizing here is deliberately NOT computeFullCardQrSizePx (that
// function's own width/height-clamp shape assumed a centered QR that
// could claim most of the card - this strip's QR box is small,
// square, and right-aligned instead). The white QR square's OUTER
// size is set by CSS alone (h-full aspect-square on the strip's own
// row height, measured via ref for its real resulting px), then
// computeQrStripSizePx sizes the QR SVG itself to fit within that
// square net of quiet-margin, same physical-cm-target approach as
// before just against a smaller box.
function PilotQrCard({
  displayWidthCm,
  targetUrl,
  captionText,
  mockupImageUrl,
}: {
  displayWidthCm: number | null
  targetUrl: string
  captionText: string
  mockupImageUrl: string
}): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const [squarePx, setSquarePx] = useState<number>(QR_STRIP_SIZE_FLOOR_PX + 2 * QR_STRIP_QUIET_MARGIN_PX)

  useLayoutEffect(() => {
    function recompute() {
      const el = cardRef.current
      if (!el) return
      setSquarePx(
        computeQrStripSquarePx({
          windowWidthPx: window.innerWidth,
          displayWidthCm,
          cardHeightPx: el.clientHeight,
        })
      )
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [displayWidthCm])

  const qrSizePx = squarePx - 2 * QR_STRIP_QUIET_MARGIN_PX

  return (
    <div ref={cardRef} className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card p-5">
      {/* Top zone - phone mockup image, contain (never crop/stretch),
          centered. min-h-0 lets this shrink below its image's natural
          size on a short viewport instead of overflowing, same fix
          shape used throughout this file's other flex children. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <img
          src={mockupImageUrl}
          alt="Pilot App preview on a smartphone"
          className="h-full max-h-full w-full max-w-full object-contain"
        />
      </div>

      {/* Bottom strip - caption left, QR right. Fixed height (not
          flex-1) so the top image zone above gets "everything else",
          matching the ~75-80/20-25 split from spec without two
          hardcoded percentages that could drift apart on resize.
          justify-between (not justify-center, and not constrained to
          the image's own column width above it) - anchors the caption
          to the strip's own left edge and the QR to its right edge,
          using the strip's FULL available width rather than the
          image's narrower column, which is what actually maximizes the
          gap between the (now larger) caption text and the QR. */}
      <div className="mt-4 flex flex-shrink-0 items-center justify-between gap-4">
        {/* Same uppercase/tracking/color caption style as before
            (text-[18px], after several consecutive size-down nudges).
            Per-tenant free text now (Step 3 of the QR slide rollout) -
            was 4 hardcoded lines specific to Shobdon's own caption
            ("Scan"/"For"/"Shobdon"/"Pilot App"). Split on whitespace,
            one word per line, as the generic default for arbitrary
            tenant-provided text - simple and predictable rather than
            trying to guess which words should share a line for text
            this component has never seen before. Left-aligned, anchored
            to the strip's own left edge via justify-between above. */}
        <div className="text-left text-[18px] uppercase leading-tight tracking-[0.25em] text-muted-500">
          {captionText
            .trim()
            .split(/\s+/)
            .map((word, index) => (
              <div key={index}>{word}</div>
            ))}
        </div>
        {/* Explicit width+height (in px, from computeQrStripSquarePx),
            not a Tailwind fixed-height + aspect-square combo - that
            combination measured SMALLER than intended inside this flex row (a real
            aspect-ratio/flex-shrink interaction, confirmed via
            Playwright, not just a theoretical concern - see
            computeQrStripSquarePx's own comment for the full story),
            so the outer box's real pixel size is computed in JS and
            applied directly instead. Same white-quiet-zone-background
            pattern as the full-card version - QR_STRIP_QUIET_MARGIN_PX
            is purely cosmetic CSS padding; the real ISO quiet-zone
            guarantee is entirely marginSize={4} on QRCodeSVG below,
            independent of this padding value. */}
        <div
          className="flex flex-shrink-0 items-center justify-center rounded-2xl bg-white"
          style={{ width: squarePx, height: squarePx, padding: QR_STRIP_QUIET_MARGIN_PX }}
        >
          <QRCodeSVG value={targetUrl} size={qrSizePx} level="M" marginSize={4} />
        </div>
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
  // Cross-component coordination for the full-height 'qr' slide (see
  // this file's own rotationStates/currentRotationState below) - fired
  // whenever the currently-showing rotation state changes between "the
  // qr slide" and "anything else". Deliberately a plain boolean
  // callback prop, not a shared context/lifted-state rewrite: RightInfoPanel
  // and GasPricesPanel are direct siblings under ONE parent
  // (Clubhouse1Template.tsx), and RightInfoPanel already owns its own
  // rotation timing entirely internally (matches this file's own
  // established "self-contained, self-managed" convention, same as its
  // self-fetch above) - a callback that only NOTIFIES the parent, without
  // requiring RightInfoPanel to give up control of its own timer/state to
  // an external store, is the minimal-footprint fit here. A context would
  // suit a genuinely deep/broad audience (this file's own WeatherContext
  // import is exactly that shape, many unrelated consumers) - two direct
  // siblings under one parent don't need that reach. Optional/undefined-safe
  // - every caller that doesn't pass it (ClassicTemplate.tsx, Clubhouse2Template.tsx,
  // neither of which pairs this component with Gas Prices) is unaffected.
  onQrSlideChange?: (isQrSlide: boolean) => void
}

export default function RightInfoPanel({ notamsOnly, opsPanelData, onQrSlideChange }: RightInfoPanelProps = {}): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()

  // Self-contained fetch of the public config, matching MediaPanel.tsx's
  // established pattern (each panel independently fetches what it needs
  // rather than threading props down from DashboardPage) - a null
  // opsPanel (e.g. a tenant that's never used /atc-control) falls back
  // to sensible static defaults below rather than rendering blank cards.
  // Skipped entirely when opsPanelData is provided (see that prop's own
  // comment).
  const [opsPanel, setOpsPanel] = useState<OpsPanelPublic | null>(opsPanelData ?? null)
  // tenants.display_width_cm (migration 0088) - a top-level sibling of
  // opsPanel on the public config response, not part of OpsPanelPublic
  // itself (it's a tenant/hardware fact, not an ops-panel setting - see
  // computeQrSizePx's own comment). Only available via this component's
  // own self-fetch below; the opsPanelData prop path (DesignPage.tsx's
  // admin preview) has no equivalent, so preview always falls back to
  // DISPLAY_WIDTH_FALLBACK_CM - acceptable, that path is for checking
  // overall look, not verifying real physical QR scan size on a tenant's
  // actual TV.
  const [displayWidthCm, setDisplayWidthCm] = useState<number | null>(null)
  // Per-tenant config for the standalone QR/phone-mockup slide (see
  // QR_CARD_ENABLED's own usage below) - Step 3 of that slide's rollout,
  // replacing the earlier tenantSlug === 'shobdon' stopgap (commit
  // acef934) that fixed a live cross-tenant content leak by hardcoding
  // the gate to one tenant while the real per-tenant fields (migration
  // 0089) were being built. Defaults to null, so the slide stays OFF
  // until the real config loads - same fail-safe-closed default the
  // opsPanel/displayWidthCm fields above already use, and correctly
  // keeps the slide off entirely for the opsPanelData prop path
  // (DesignPage.tsx's admin preview), which never populates this.
  const [qrSlideConfig, setQrSlideConfig] = useState<{
    enabled: boolean
    targetUrl: string
    captionText: string
    mockupImageUrl: string | null
  } | null>(null)
  // Runway-direction staleness bug fix: this self-fetch used to run only
  // once on mount, same as every other desktop panel's own self-fetch -
  // fine for opsPanel/displayWidthCm/qrSlideConfig's OTHER fields, which
  // change rarely, but activeRunwayEnd/circuitDirection (inside opsPanel)
  // can change at any time via SADDS automation (functions/api/ingest/
  // weather.ts) or a manual ATC Control publish, with nothing to tell an
  // already-open TV/browser tab it's now stale - confirmed as the root
  // cause of a real production incident (runway direction stuck after a
  // SADDS toggle, while wind/QNH/temp kept updating live via
  // WeatherContext's own polling). refreshTick mirrors /pilot's own fix
  // for the identical problem (PilotViewPage.tsx's 60s tick, consumed by
  // PilotRunwayWindPanel.tsx via a `refreshSignal` prop) - same interval,
  // same "increment a counter, add it to this effect's deps to re-run
  // the existing fetch" mechanism, just owned locally rather than
  // threaded down as a prop, since this component (like every other
  // desktop panel) is already established as fully self-contained/self-
  // fetching, not driven by parent-supplied state - see this file's own
  // repeated comments on that convention. Deliberately not a NEW/third
  // polling pattern, just this same one applied without prop-threading.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (opsPanelData !== undefined) return
    const interval = window.setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [opsPanelData])

  useEffect(() => {
    if (opsPanelData !== undefined) {
      setOpsPanel(opsPanelData)
      return
    }
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setOpsPanel(data?.opsPanel ?? null)
          setDisplayWidthCm(typeof data?.displayWidthCm === 'number' ? data.displayWidthCm : null)
          setQrSlideConfig(
            data?.qrSlide && typeof data.qrSlide === 'object'
              ? {
                  enabled: !!data.qrSlide.enabled,
                  targetUrl: typeof data.qrSlide.targetUrl === 'string' ? data.qrSlide.targetUrl : '',
                  captionText: typeof data.qrSlide.captionText === 'string' ? data.qrSlide.captionText : '',
                  mockupImageUrl: typeof data.qrSlide.mockupImageUrl === 'string' ? data.qrSlide.mockupImageUrl : null,
                }
              : null
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [opsPanelData, refreshTick])

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
  //
  // 'qr' spliced in right after 'ops', before any NOTAM entries - per
  // explicit instruction, so it appears reliably early in every cycle
  // regardless of how many NOTAM cards currently exist, rather than its
  // wait-before-first-appearance scaling with NOTAM count the way it
  // would at the end of the array. Omitted entirely (not just hidden)
  // when QR_CARD_ENABLED is false, matching the same "don't include
  // state you're not going to render" convention notamCardGroups
  // already uses for zero NOTAMs.
  //
  // Per-tenant gate (Step 3 of the QR slide rollout, migration 0089) -
  // replaces the earlier tenantSlug === 'shobdon' stopgap (commit
  // acef934, itself a fix for a live cross-tenant content leak - the
  // slide was rendering Shobdon's own hardcoded content on every
  // tenant's rotation). qrSlideConfig defaults to null until the
  // self-fetch resolves, so this stays off for that brief window on
  // every tenant including one that has it enabled - acceptable (same
  // fail-safe-closed posture as the stopgap it replaces).
  //
  // Also requires a real mockupImageUrl and a non-empty targetUrl, not
  // just `enabled` - a tenant can flip the toggle on before uploading an
  // image via the Platform Tenants dev UI (qr_mockup_r2_key stays null
  // until they do), and an empty target URL would encode a meaningless
  // QR. Per explicit instruction: don't add the 'qr' entry to rotation
  // at all in that case, rather than showing a broken/empty card -
  // logged below so a developer notices the tenant needs to finish
  // configuring it, not silently missing from the rotation.
  const qrSlideReady = !!(qrSlideConfig?.enabled && qrSlideConfig.mockupImageUrl && qrSlideConfig.targetUrl.trim())
  if (qrSlideConfig?.enabled && !qrSlideReady && shouldLogQrSizingWarnings()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[RightInfoPanel] QR slide is enabled for this tenant but not fully configured yet (${
        !qrSlideConfig.mockupImageUrl ? 'no mockup image uploaded' : 'target URL is empty'
      }) - omitted from the rotation until both are set via the Platform Tenants dev tools.`
    )
  }
  const rotationStates: RotationState[] = [
    { type: 'ops' },
    ...(QR_CARD_ENABLED && qrSlideReady ? [{ type: 'qr' as const }] : []),
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
        state.type === 'ops'
          ? (opsPanel?.notamsOpsDurationSeconds ?? 5)
          : state.type === 'qr'
            ? QR_CARD_DURATION_SECONDS
            : (opsPanel?.notamsFullDurationSeconds ?? 5)
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

  // Notify the parent (Clubhouse1Template.tsx) whenever the qr slide
  // starts/stops showing - see onQrSlideChange's own prop comment for
  // why this is a plain notification callback rather than a bigger
  // architectural change. Effect (not called inline during render) so
  // it never fires the parent's own setState synchronously during
  // RightInfoPanel's render pass - React would warn/misbehave on a
  // parent state update triggered mid-child-render otherwise. Depends
  // on the actual boolean value (not the whole currentRotationState
  // object, which is a new object reference every render regardless of
  // whether the type actually changed) so this only actually calls the
  // callback on genuine ops<->qr<->notamsFull transitions, not on every
  // one of this component's own re-renders.
  const isQrSlide = currentRotationState.type === 'qr'
  useEffect(() => {
    onQrSlideChange?.(isQrSlide)
  }, [isQrSlide, onQrSlideChange])

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
  // '--' (was '08/26') - the previous fallback used the airfield's full
  // runway-PAIR designator (both physical ends), but this square only
  // ever shows a single active runway END once real data loads (e.g.
  // "26", 1-2 characters) - '08/26' is 5 characters, wider than
  // runwayNumberFontPx's square/font ratio was ever tuned to fit, so it
  // visibly overflowed and got clipped by the square's own
  // overflow-hidden during the real (network-fetch-length) window
  // before opsPanel loads on every page load. '--' matches the real
  // field's own 1-2 character shape, so it renders at the exact same
  // size as a real value - nothing to overflow.
  const runwayStatusValue = opsPanel ? opsPanel.activeRunwayEnd : '--'
  const cards = [...(airfieldInfoText ? [{ title: 'Airfield Info', value: airfieldInfoText }] : [])]

  // Pilot App QR sizing - refs into the real rendered DOM (card 1's own
  // root for total available height, the Runway In Use/QR row for
  // available width, Airfield Info's own card for its real height) so
  // computeQrSizePx clamps against actual layout rather than guessed
  // constants. Declared unconditionally (before the notamsOnly early
  // return below) per the rules of hooks - notamsOnly's own branch never
  // renders card 1 at all, so these refs simply stay unattached/null
  // there, which computeQrSizePx's own effect already guards against.
  const card1RootRef = useRef<HTMLDivElement>(null)
  const rowContainerRef = useRef<HTMLDivElement>(null)
  const airfieldInfoCardRef = useRef<HTMLDivElement>(null)
  const [qrSizePx, setQrSizePx] = useState<number>(() => {
    // Synchronous initial guess (no DOM measurement available yet on
    // first render) so the row has a real size to paint immediately -
    // corrected, before the browser paints, by the layout effect below
    // once refs are attached. Uses the fallback cm assumption
    // unconditionally here (the tenant's real displayWidthCm hasn't
    // loaded yet either); the effect re-runs once it has.
    if (typeof window === 'undefined') return 120
    return Math.max(QR_SIZE_FLOOR_PX, Math.floor((TARGET_QR_CM * window.innerWidth) / DISPLAY_WIDTH_FALLBACK_CM))
  })

  useLayoutEffect(() => {
    function recompute() {
      const card1El = card1RootRef.current
      const rowEl = rowContainerRef.current
      if (!card1El || !rowEl) return
      setQrSizePx(
        computeQrSizePx({
          windowWidthPx: window.innerWidth,
          displayWidthCm,
          card1HeightPx: card1El.clientHeight,
          rowWidthPx: rowEl.clientWidth,
          airfieldInfoHeightPx: airfieldInfoCardRef.current?.clientHeight ?? 0,
        })
      )
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [displayWidthCm, cards.length, noticesForDisplay.length, opsPanel?.runwaysClosed])

  // Matched-square restyle - the QR SVG's own clamped size plus its
  // quiet margin on both sides is the canonical square size; Runway In
  // Use's square just matches this value exactly (see the row's own
  // render comment), not an independently-sized card.
  const squareSize = qrSizePx + 2 * QR_QUIET_MARGIN_PX

  // Text sizes scale proportionally with squareSize rather than using
  // fixed Tailwind classes - found via real measurement (not assumed) in
  // an earlier round that a fixed size correct at 1920x1080 (squareSize
  // ~177px) overflowed with NEGATIVE padding at 1366x768 (squareSize
  // ~81px, computeQrSizePx clamps the square smaller there to protect
  // Notices) - the square's real size varies per-viewport/per-tenant by
  // design, so a fixed px/rem size can't be correct at every size the
  // square can actually end up; scaling proportionally keeps the same
  // relative fit at any squareSize instead.
  //
  // runwayNumberFontPx (left square) - the runway number is now the
  // square's ONLY content (circuit direction moved to the right square,
  // this round), so it can run larger than when the two shared one
  // square - ratio bumped from 0.34 to 0.55 in an earlier round, then
  // nudged back down to 0.53 after visual review found 0.55 (97px at
  // 1920x1080) slightly overpowering - 0.53 lands at 94px there, a 3px
  // reduction, re-measured to confirm padding stays clearly visible on
  // all sides after the drop.
  const runwayNumberFontPx = Math.max(18, Math.round(squareSize * 0.53))
  // Defensive against a repeat of this round's '08/26' overflow bug -
  // runwayNumberFontPx's 0.53 ratio was tuned by real measurement
  // against a 1-2 character runway end (e.g. "26", occasionally "26L"
  // with a suffix). It's normally never anything else (activeRunwayEnd
  // is a controlled ATC field, and the fallback above is now the same
  // 1-2 character shape), but if runwayStatusValue is ever LONGER than
  // that for any reason not anticipated here (a future fallback change,
  // an unexpected data value, anything), scale the font down
  // proportionally to length instead of silently overflowing and
  // relying on the square's own overflow-hidden to crop it into an
  // illegible clipped fragment (which is exactly what '08/26' did).
  // Only kicks in above 2 characters - the real/common case is
  // completely unaffected (same font size as before).
  const runwayDisplayFontPx =
    runwayStatusValue.length <= 2
      ? runwayNumberFontPx
      : Math.max(12, Math.round(runwayNumberFontPx * (2 / runwayStatusValue.length)))
  // circuitLabelFontPx (right square, QR paused) - "RIGHT"/"LEFT" and
  // "CIRCUIT" stacked on two lines; CIRCUIT (7 characters) is the wider
  // line regardless of direction, so it's the binding width case -
  // ratio calibrated by real measurement against both directions at
  // 1920x1080 and 1366x768 (see this round's report for the actual
  // numbers), not guessed.
  const circuitLabelFontPx = Math.max(12, Math.round(squareSize * 0.19))

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
        ) : currentRotationState.type === 'qr' ? (
          // qrSlideReady (checked when rotationStates was built above)
          // already guarantees qrSlideConfig is non-null with a real
          // mockupImageUrl and non-empty targetUrl whenever this branch
          // can actually be reached this render - the ?? fallbacks here
          // are just to satisfy the type checker, not real runtime cases.
          <PilotQrCard
            displayWidthCm={displayWidthCm}
            targetUrl={qrSlideConfig?.targetUrl ?? ''}
            captionText={qrSlideConfig?.captionText ?? ''}
            mockupImageUrl={qrSlideConfig?.mockupImageUrl ?? ''}
          />
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
          <div className="flex h-full flex-col gap-3" ref={card1RootRef}>
            {/* Runway In Use / Pilot App QR row - always rendered now
                (the old fixed 1600px viewport-width breakpoint is gone
                entirely, see computeQrSizePx's own comment). QR size is
                an explicit px value computed from the tenant's real
                physical screen width, clamped against this row's actual
                measured space - so the row's own height is whatever that
                clamped size needs, not driven by a flex ratio/CSS
                percentage the way the previous round's QR row was. */}
            {/* Matched-square restyle - Runway In Use and Circuit are
                two equal squares (width === height, and the two match
                each other exactly), each with its own label caption
                BELOW the square rather than a header above/inside it.
                squareSize is derived from qrSizePx/computeQrSizePx
                below - a holdover name from when this row's right
                square could render an actual QR code (now removed, see
                this file's own history); the sizing math itself is
                still genuinely shared/live for both squares' box size
                and font ratios, just no longer QR-specific in what it
                produces. Runway In Use doesn't get an independent size,
                it just matches whatever that comes out to, per spec
                ("sized to match each other exactly regardless of
                content"). */}
            <div className="flex flex-shrink-0 gap-3" ref={rowContainerRef}>
              <div className="flex flex-col items-center" style={{ width: squareSize }}>
                <div
                  className="flex flex-col overflow-hidden rounded-3xl border border-border bg-card"
                  style={{ width: squareSize, height: squareSize }}
                >
                  {/* Number-only now (circuit direction moved to the
                      right square, this round) - a single centered
                      element, p-3 keeps it off the square's own edges
                      at any squareSize. runwaysClosed shows "CLOSED"
                      here instead - the right square keeps showing
                      circuit direction regardless of closure (that text
                      is still factually correct, it's just this square's
                      big number that loses meaning when the runway
                      itself is shut), so only this one element swaps. */}
                  <div className="flex h-full w-full items-center justify-center p-3">
                    {opsPanel?.runwaysClosed ? (
                      // ATC override (migration 0054) - activeRunwayEnd
                      // stays set underneath (see AtcControlPage.tsx's
                      // toggle comment), this is purely a display swap.
                      // "CLOSED" (6 characters) can't run as large as the
                      // 2-character runway number and still fit on one
                      // line - sized off circuitLabelFontPx instead (the
                      // ratio already calibrated for a similar-length
                      // word, "CIRCUIT", 7 characters, on the right
                      // square) with the same headroom multiplier the
                      // old two-line "RUNWAYS"/"CLOSED" state used.
                      <div
                        className="whitespace-nowrap font-bold leading-none text-status-bad"
                        style={{ fontSize: circuitLabelFontPx * 1.3 }}
                      >
                        CLOSED
                      </div>
                    ) : (
                      <div
                        className="whitespace-nowrap font-bold leading-none text-primary"
                        style={{ fontSize: runwayDisplayFontPx }}
                      >
                        {runwayStatusValue}
                      </div>
                    )}
                  </div>
                </div>
                {/* Caption BELOW the square, outside its own container -
                    replaces the old "RUNWAY IN USE" header entirely (no
                    header inside/above the square anymore). Same label
                    style as NOTICES/AIRFIELD INFO elsewhere in this
                    panel (text-xs uppercase tracking-[0.25em]
                    text-muted-500), matched font-size/weight/letter-
                    spacing against the QR square's own "PILOTS APP"
                    caption below so the two read as a deliberate pair. */}
                <div className="mt-1 text-center text-xs uppercase tracking-[0.25em] text-muted-500">Runway</div>
              </div>
              <div className="flex flex-col items-center" style={{ width: squareSize }}>
                {/* Circuit direction, unconditionally - this square's
                    own former QR-vs-CIRCUIT-text toggle (QR_ENABLED) was
                    removed once the full-height standalone QR rotation
                    slide fully superseded it (see PilotQrCard elsewhere
                    in this file). "CIRCUIT" (7 characters) is the wider
                    line regardless of direction - circuitLabelFontPx is
                    calibrated against it, see that constant's comment. */}
                <div
                  className="flex flex-col items-center justify-center gap-1 overflow-hidden rounded-3xl border border-border bg-card p-3"
                  style={{ width: squareSize, height: squareSize }}
                >
                  <div
                    className="whitespace-nowrap font-bold leading-none text-primary"
                    style={{ fontSize: circuitLabelFontPx }}
                  >
                    {circuitDirectionLabel(opsPanel?.circuitDirection ?? 'left').toUpperCase()}
                  </div>
                  <div
                    className="whitespace-nowrap font-bold leading-none text-primary"
                    style={{ fontSize: circuitLabelFontPx }}
                  >
                    CIRCUIT
                  </div>
                </div>
                {/* Caption below the square, on the card's normal dark
                    background - "Circuit" now (was "Runway In Use",
                    which read oddly for a square whose content is the
                    circuit direction, not "Pilots App" further back
                    when it was still paired with the QR). Same label
                    style as "Runway" on the left square, matched
                    caption row height (mt-1, single text-xs line) so
                    both columns still read as equal tiles. */}
                <div className="mt-1 text-center text-xs uppercase tracking-[0.25em] text-muted-500">Circuit</div>
              </div>
            </div>
            {/* p-3/mt-1/text-2xl (was p-4/mt-2/text-3xl) - tightened
                alongside the QR row above, to give Notices back some of
                the height the new row's own taller (QR-driven) footprint
                costs it. Small/single-line content either way; doesn't
                need the old full-size breathing room to stay readable.
                ref on the first (only) card - airfieldInfoHeightPx in
                computeQrSizePx needs a real measured height, and `cards`
                is always 0 or 1 entries (see this const's own comment
                above), so there's never more than one to attach it to. */}
            {cards.map((card, index) => (
              <div
                key={card.title}
                ref={index === 0 ? airfieldInfoCardRef : undefined}
                className="flex-shrink-0 rounded-3xl border border-border bg-card p-3"
              >
                <div className="text-xs uppercase tracking-[0.25em] text-muted-500">{card.title}</div>
                <div className="mt-1 text-2xl font-semibold text-primary">{card.value}</div>
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
