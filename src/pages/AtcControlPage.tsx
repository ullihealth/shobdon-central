import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { OPS_PANEL_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'

const AIRFIELD_INFO_MAX_LENGTH = 60
const SAFETY_NOTICE_MAX_LENGTH = 40
const SAFETY_NOTICE_NAME_MAX_LENGTH = 40
const SAFETY_NOTICE_ROWS = 10
const NOTAMS_INTERVAL_MIN_SECONDS = 2
const NOTAMS_INTERVAL_MAX_SECONDS = 30
const NOTAMS_INTERVAL_DEFAULT_SECONDS = 5
const WEATHER_SUMMARY_STATE_A_DEFAULT_SECONDS = 8
const WEATHER_SUMMARY_STATE_B_DEFAULT_SECONDS = 5

type CircuitDirection = 'left' | 'right'
type NoticeSize = 'sm' | 'md' | 'lg' | 'xl'
type ApplyStatus = 'idle' | 'working' | 'success' | 'error'

interface SafetyNotice {
  // Optional - undefined for a still-blank row that's never been saved;
  // real notices always have one by the time they reach this page
  // (self-healed server-side, see ops-panel/index.ts). Also now
  // manageable directly from CAFE MEDIA (Part C) - this page and that
  // one read/write the exact same underlying data, so a name/notice
  // created or edited on either shows up on both.
  id?: string
  name?: string
  text: string
  size: NoticeSize
  enabled: boolean
}

// Full shape of GET/PUT /api/tenant/ops-panel's response/body (mirrors
// MediaManagerPage.tsx's own OpsPanelFullState) - this endpoint is a
// full-replace, so any save must include every field, not just the ones
// this page's own UI exposes (notamsOpsDurationSeconds/
// notamsFullDurationSeconds/noticesDurationSeconds are edited only on
// MediaManagerPage.tsx). Retaining the raw GET response here and
// spreading it under this page's own current field values in
// handleUpdateDashboard fixes exactly that gap - a hand-built partial
// payload silently 400'd on every save once the backend started
// requiring those three fields, regardless of what was actually being
// changed.
interface OpsPanelFullState {
  activeRunwayEnd: string
  circuitDirection: CircuitDirection
  airfieldInfoText: string
  safetyNotices: SafetyNotice[]
  showAutoNotams: boolean
  runwaysClosed: boolean
  runwayAutomationEnabled: boolean
  notamsCarouselIntervalSeconds: number
  notamsOpsDurationSeconds: number
  notamsFullDurationSeconds: number
  noticesDurationSeconds: number
  weatherSummaryChartEnabled: boolean
  weatherSummaryStateADurationSeconds: number
  weatherSummaryStateBDurationSeconds: number
}

const NOTICE_SIZE_OPTIONS: { value: NoticeSize; label: string }[] = [
  { value: 'sm', label: 'Sm' },
  { value: 'md', label: 'Med' },
  { value: 'lg', label: 'Lg' },
  { value: 'xl', label: 'Xl' },
]

// Compact inline selector for the per-notice size - the existing
// ToggleButton is sized for the page's big binary toggles (text-4xl,
// py-8) and would be wrong here; this sits next to each row's character
// counter, not as its own section.
function SizeSelector({
  value,
  onChange,
}: {
  value: NoticeSize
  onChange: (size: NoticeSize) => void
}): JSX.Element {
  return (
    <div className="flex gap-1">
      {NOTICE_SIZE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition ${
            value === option.value
              ? 'bg-accent-sky-500 text-white'
              : 'bg-slate-800 text-muted-400 hover:bg-slate-700'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// Compact pill/segmented-control toggle - replaces the old full-width,
// oversized ToggleButton (text-4xl, py-8 cards) for Runway/Circuit/NOTAM
// on-off, so these three quick binary choices no longer each consume a
// full-width section of their own.
//
// SADDS automation round, revised: `locked` is now a REAL click-guard,
// not just a visual dimming - onChange simply never fires while locked
// (see the onClick below), so there's nothing left for a caller to
// intercept/redirect on click the way the previous round's confirm-on-
// click handlers did. `lockedMessage`, shown only on hover (never on
// click, per explicit instruction), is this toggle's own local state -
// each SegmentedToggle usage gets its own independent instance
// (Runway/Circuit/Automation/NOTAM/Chart Rotation), so hovering one
// never affects another.
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  locked = false,
  lockedMessage,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  locked?: boolean
  lockedMessage?: string
}): JSX.Element {
  const [showLockedMessage, setShowLockedMessage] = useState(false)

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => {
        if (locked) setShowLockedMessage(true)
      }}
      onMouseLeave={() => setShowLockedMessage(false)}
    >
      <div className={`inline-flex rounded-lg border border-slate-700 bg-slate-900/60 p-1 ${locked ? 'opacity-50' : ''}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              if (locked) return
              onChange(option.value)
            }}
            className={`rounded-md px-5 py-1.5 text-sm font-bold uppercase tracking-wide transition ${
              value === option.value ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-white'
            } ${locked ? 'cursor-not-allowed' : ''}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {locked && showLockedMessage && lockedMessage && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border border-status-bad bg-slate-950 px-3 py-2 text-xs font-semibold text-status-bad shadow-lg shadow-slate-950/40">
          {lockedMessage}
        </div>
      )}
    </div>
  )
}

export default function AtcControlPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [runwayEnds, setRunwayEnds] = useState<[string, string]>(['08', '26'])
  const [activeRunwayEnd, setActiveRunwayEnd] = useState('08')
  const [circuitDirection, setCircuitDirection] = useState<CircuitDirection>('left')
  const [airfieldInfoText, setAirfieldInfoText] = useState('')
  // Array.from, not .fill({...}) - .fill() would share ONE object
  // reference across all 10 rows, so editing row 1 would silently edit
  // every row.
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>(
    Array.from({ length: SAFETY_NOTICE_ROWS }, () => ({ text: '', size: 'md', enabled: true }))
  )
  // ATC-triggered override (migration 0054) - when on, every render
  // location that shows activeRunwayEnd/circuitDirection shows "RUNWAYS
  // CLOSED" instead, everywhere at once (see RightInfoPanel.tsx's own
  // comment). Independent of activeRunwayEnd/circuitDirection - closing
  // doesn't clear which end was active, so re-opening restores it
  // without needing to re-pick.
  const [runwaysClosed, setRunwaysClosed] = useState(false)
  // SADDS automation round (migration 0076) - true (default) means
  // functions/api/ingest/weather.ts keeps activeRunwayEnd/
  // circuitDirection in sync with SADDS captures automatically, and the
  // manual buttons below are locked (click does nothing, hover shows a
  // warning - see SegmentedToggle's own comment; turning this off is
  // confirmed via handleRunwayAutomationToggle). A DIFFERENT concept from
  // autoLinkRunwayCircuit below - that one just mirrors runway<->circuit
  // selection while editing manually, purely client-side, never sent to
  // the backend; this one is a real server-enforced flag gating whether
  // manual edits are accepted at all (see ops-panel/index.ts's own PUT
  // lock).
  const [runwayAutomationEnabled, setRunwayAutomationEnabled] = useState(true)
  const [showAutoNotams, setShowAutoNotams] = useState(true)
  const [notamsIntervalSeconds, setNotamsIntervalSeconds] = useState(NOTAMS_INTERVAL_DEFAULT_SECONDS)
  // Default OFF matches the D1 column's own DEFAULT 0 - deploying this
  // feature is a zero-visible-change event until explicitly turned on
  // here and published.
  const [weatherSummaryChartEnabled, setWeatherSummaryChartEnabled] = useState(false)
  const [weatherSummaryStateADuration, setWeatherSummaryStateADuration] = useState(WEATHER_SUMMARY_STATE_A_DEFAULT_SECONDS)
  const [weatherSummaryStateBDuration, setWeatherSummaryStateBDuration] = useState(WEATHER_SUMMARY_STATE_B_DEFAULT_SECONDS)
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')
  // Purely a local editing convenience, never sent to the backend and
  // never loaded from it - functions/api/tenant/ops-panel/index.ts only
  // stores/reads the RESULTING activeRunwayEnd/circuitDirection values,
  // with no concept of how they were arrived at, and the public Ops
  // Panel display has no use for "was auto-link on" either. Always
  // starts ON each time this page loads, independent of whatever was
  // last published - default ON matches today's expected behaviour out
  // of the box.
  const [autoLinkRunwayCircuit, setAutoLinkRunwayCircuit] = useState(true)
  // Parent/sub-tenant round - purely informational, never changes what
  // this page saves (still this tenant's own ops_panel_state row
  // either way, see functions/api/tenant/ops-panel/index.ts, untouched
  // by this round). When set, Runway In Use/Circuit Direction as staged
  // and published HERE are stored but shadowed on the live dashboard by
  // the parent's own value instead (functions/api/_utils/
  // publicConfig.ts) - ATC staff on a linked sub-tenant should know that
  // before wondering why their change didn't show up live.
  const [parentAirfieldName, setParentAirfieldName] = useState<string | null>(null)
  // Raw last-fetched GET response, retained purely so
  // handleUpdateDashboard can spread it under this page's own edited
  // fields on save - see OpsPanelFullState's own comment. Never read
  // from directly for rendering (the individual useState fields above
  // are what the UI actually binds to); this is save-time plumbing only.
  const [opsPanelState, setOpsPanelState] = useState<OpsPanelFullState | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(OPS_PANEL_URL).then((response) => (response.ok ? response.json() : null)),
      fetch(PUBLIC_CONFIG_URL).then((response) => (response.ok ? response.json() : null)),
      fetch('/api/tenant/parent-tenant').then((response) => (response.ok ? response.json() : null)),
    ]).then(([opsPanel, publicConfig, parentTenant]) => {
      if (parentTenant?.parentTenantName) setParentAirfieldName(parentTenant.parentTenantName)
      // endAIdentifier/endBIdentifier are admin-typed free text (e.g.
      // "08"/"26"), not a fixed enum - read the two real toggle options
      // rather than assuming which identifiers this tenant actually uses.
      const endA: string | undefined = publicConfig?.runwayGroups?.[0]?.endAIdentifier
      const endB: string | undefined = publicConfig?.runwayGroups?.[0]?.endBIdentifier
      if (endA && endB) setRunwayEnds([endA, endB])

      if (opsPanel) {
        setOpsPanelState(opsPanel)
        setActiveRunwayEnd(opsPanel.activeRunwayEnd || (endA ?? '08'))
        setCircuitDirection(opsPanel.circuitDirection === 'right' ? 'right' : 'left')
        setAirfieldInfoText(opsPanel.airfieldInfoText ?? '')
        const notices: SafetyNotice[] = Array.isArray(opsPanel.safetyNotices) ? opsPanel.safetyNotices : []
        setSafetyNotices(
          Array.from({ length: SAFETY_NOTICE_ROWS }, (_, i) => notices[i] ?? { text: '', size: 'md', enabled: true })
        )
        setRunwaysClosed(opsPanel.runwaysClosed ?? false)
        setRunwayAutomationEnabled(opsPanel.runwayAutomationEnabled ?? true)
        setShowAutoNotams(opsPanel.showAutoNotams ?? true)
        setNotamsIntervalSeconds(opsPanel.notamsCarouselIntervalSeconds ?? NOTAMS_INTERVAL_DEFAULT_SECONDS)
        setWeatherSummaryChartEnabled(opsPanel.weatherSummaryChartEnabled ?? false)
        setWeatherSummaryStateADuration(opsPanel.weatherSummaryStateADurationSeconds ?? WEATHER_SUMMARY_STATE_A_DEFAULT_SECONDS)
        setWeatherSummaryStateBDuration(opsPanel.weatherSummaryStateBDurationSeconds ?? WEATHER_SUMMARY_STATE_B_DEFAULT_SECONDS)
      }
      setLoading(false)
    })
  }, [])

  // Hardcoded literal '26'/'08', NOT matched by position (runwayEnds[0]/
  // [1], i.e. endAIdentifier/endBIdentifier) - this used to match by
  // position on the theory that identifiers are admin-typed free text,
  // not a fixed enum, so a literal match would silently break for any
  // tenant numbered differently. In practice that made this auto-link
  // mapping silently depend on which of endA/endB happened to hold "26"
  // vs "08" - correct only as an accident of data ordering, and it
  // flipped (Left<->08, Right<->26, backwards) the moment
  // endAIdentifier/endBIdentifier were corrected for the unrelated
  // headwind-calculation bug (CompassPanel.tsx), since that fix swapped
  // which end was endA vs endB without changing which end was
  // physically 26 vs 08. Per explicit instruction: Left<->26, Right<->08
  // is Shobdon's actual physical/fixed pairing, not something that
  // varies with admin data entry.
  //
  // Revisited (parent/sub-tenant round): a second real tenant (Gyroplane
  // Train) now exists, but this hardcode is still correct for it too -
  // it has no runway of its own at all, it INHERITS Shobdon's exact
  // runway/compass data when linked as a sub-tenant (tenants.
  // parent_tenant_id, migration 0059 - see functions/api/_utils/
  // publicConfig.ts's own comment), so runwayEnds fetched on this very
  // page already resolves to Shobdon's real "08"/"26" for a linked
  // sub-tenant too, not a distinct convention of its own. What this
  // hardcode still does NOT handle correctly: a genuinely INDEPENDENT
  // second airfield (its own physical runway, no parent link) with a
  // different real left/right-circuit pairing - that would need real
  // per-tenant storage for the pairing itself, which doesn't exist
  // anywhere yet and is out of this round's scope (no such tenant exists
  // to build it for). Revisit when one does.
  //
  // Only auto-fires when Auto-link is ON - this is what makes the link
  // avoidable rather than unconditional: with it OFF these two setters
  // never touch each other, so "unusual" combinations (e.g. 08 + Left)
  // can be manually set and held.
  function handleRunwayEndChange(end: string) {
    setActiveRunwayEnd(end)
    if (!autoLinkRunwayCircuit) return
    if (end === '26') setCircuitDirection('left')
    else if (end === '08') setCircuitDirection('right')
  }

  function handleCircuitDirectionChange(direction: CircuitDirection) {
    setCircuitDirection(direction)
    if (!autoLinkRunwayCircuit) return
    setActiveRunwayEnd(direction === 'left' ? '26' : '08')
  }

  // SADDS automation round, revised: the confirm now lives on the
  // Automation toggle itself, not on the individual Runway/Circuit
  // buttons (see SegmentedToggle's own comment on why those buttons no
  // longer intercept onChange at all while locked). Only the ON->OFF
  // direction needs confirming - flipping back on is never destructive,
  // so it's a plain, immediate state change with no dialog. Still only
  // STAGES runwayAutomationEnabled, same as every other control on this
  // page - nothing reaches the live dashboard until Update Dashboard is
  // clicked, so cancelling here has nothing to undo beyond the toggle's
  // own local value.
  function handleRunwayAutomationToggle(next: 'on' | 'off') {
    if (next === 'on') {
      setRunwayAutomationEnabled(true)
      return
    }
    if (
      !window.confirm(
        'Disable SADDS Automation and take manual control of Runway In Use and Circuit Direction?\n\nThis only stages the change - click "Update Dashboard" afterward to publish it.'
      )
    ) {
      return
    }
    setRunwayAutomationEnabled(false)
  }

  function handleAirfieldInfoChange(event: ChangeEvent<HTMLInputElement>) {
    setAirfieldInfoText(event.target.value.slice(0, AIRFIELD_INFO_MAX_LENGTH))
  }

  function handleNoticeChange(index: number, value: string) {
    setSafetyNotices((prev) =>
      prev.map((n, i) => (i === index ? { ...n, text: value.slice(0, SAFETY_NOTICE_MAX_LENGTH) } : n))
    )
  }

  function handleNoticeNameChange(index: number, value: string) {
    setSafetyNotices((prev) =>
      prev.map((n, i) => (i === index ? { ...n, name: value.slice(0, SAFETY_NOTICE_NAME_MAX_LENGTH) } : n))
    )
  }

  function handleNoticeSizeChange(index: number, size: NoticeSize) {
    setSafetyNotices((prev) => prev.map((n, i) => (i === index ? { ...n, size } : n)))
  }

  function handleNoticeEnabledChange(index: number, enabled: boolean) {
    setSafetyNotices((prev) => prev.map((n, i) => (i === index ? { ...n, enabled } : n)))
  }

  function handleNotamsIntervalChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    if (raw === '') {
      setNotamsIntervalSeconds(NOTAMS_INTERVAL_MIN_SECONDS)
      return
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    const clamped = Math.min(NOTAMS_INTERVAL_MAX_SECONDS, Math.max(NOTAMS_INTERVAL_MIN_SECONDS, Math.round(parsed)))
    setNotamsIntervalSeconds(clamped)
  }

  // Deliberately not auto-saved on every toggle/keystroke - everything
  // above is staged local state until this is clicked, giving ATC a
  // clear, single moment where a change is actually published. Same
  // PUT-then-refresh-trigger flow as /design's "Apply to Live Screen"
  // (handleApplyToLiveScreen) - reusing that exact mechanism rather
  // than building a second one.
  async function handleUpdateDashboard() {
    if (
      !window.confirm(
        'Push these changes to the live dashboard? This affects every device that loads it (PC2, clubhouse display, etc.) within about 15 seconds.'
      )
    ) {
      return
    }

    setApplyStatus('working')
    try {
      // Full-replace endpoint - spread the last-loaded full row first
      // (opsPanelState) so fields this page has no UI for
      // (notamsOpsDurationSeconds/notamsFullDurationSeconds/
      // noticesDurationSeconds, owned by MediaManagerPage.tsx) round-trip
      // unchanged, then override with this page's own current values.
      // Same {...current, ...patch} pattern as MediaManagerPage.tsx's own
      // updateOpsPanelTiming - fixes a save that previously 400'd on
      // every submit regardless of what was actually changed, and
      // prevents any future required field from silently breaking this
      // page's save again.
      const response = await fetch(OPS_PANEL_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...opsPanelState,
          activeRunwayEnd,
          circuitDirection,
          airfieldInfoText,
          safetyNotices: safetyNotices.filter((n) => n.text.trim().length > 0),
          runwaysClosed,
          runwayAutomationEnabled,
          showAutoNotams,
          notamsCarouselIntervalSeconds: notamsIntervalSeconds,
          weatherSummaryChartEnabled,
          weatherSummaryStateADurationSeconds: weatherSummaryStateADuration,
          weatherSummaryStateBDurationSeconds: weatherSummaryStateBDuration,
        }),
      })
      if (!response.ok) {
        setApplyStatus('error')
        return
      }
      await fetch(REFRESH_TRIGGER_URL)
      setApplyStatus('success')
    } catch {
      setApplyStatus('error')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-10">
      {/* ── Heading + Update Dashboard, side by side (was stacked) ───── */}
      <div className="mb-6 grid grid-cols-2 items-start gap-6">
        <div>
          <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">ATC Control</h1>
          <p className="max-w-2xl text-sm text-muted-400">
            Edit the live Ops Panel. Nothing here reaches the dashboard until you click "Update Dashboard" -
            toggle and type freely, changes are only staged locally until then.
          </p>
        </div>

        {!loading && (
          <div className="sticky top-4 z-20 ml-auto w-80 rounded-xl border border-accent-sky-500/40 bg-slate-950/95 px-5 py-3 shadow-lg shadow-slate-950/40 backdrop-blur">
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Update Dashboard</div>
            <p className="mb-2 text-xs text-muted-500">
              Publishes the staged changes below to the live dashboard - every device that loads it picks them up
              within about 15 seconds.
            </p>
            {applyStatus === 'success' && (
              <p className="mb-2 text-xs font-semibold text-status-good">Published - live dashboard will update shortly.</p>
            )}
            {applyStatus === 'error' && (
              <p className="mb-2 text-xs font-semibold text-status-bad">Failed to publish - check your connection and try again.</p>
            )}
            <button
              type="button"
              onClick={handleUpdateDashboard}
              disabled={applyStatus === 'working'}
              className="rounded-lg bg-accent-sky-500 px-6 py-2.5 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {applyStatus === 'working' ? 'Updating…' : 'Update Dashboard'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-400">Loading…</p>
      ) : (
        <>
          {/* ── Runway in use + Circuit direction + Airfield info, one row ─ */}
          <label className="mb-2 flex w-fit items-center gap-2">
            <input
              type="checkbox"
              checked={autoLinkRunwayCircuit}
              onChange={(event) => setAutoLinkRunwayCircuit(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
              Auto-link runway &amp; circuit
            </span>
          </label>
          <p className="mb-3 max-w-md text-xs text-muted-500">
            {autoLinkRunwayCircuit
              ? 'Selecting a runway end sets the matching circuit direction, and vice versa.'
              : 'Runway and circuit now behave independently - any combination can be set manually.'}
          </p>
          {/* ── SADDS Automation ─────────────────────────────────────── */}
          <div className="mb-3 max-w-2xl rounded-xl border border-accent-sky-500/40 bg-accent-sky-500/5 px-5 py-4">
            <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">SADDS Automation</div>
            <SegmentedToggle
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              value={runwayAutomationEnabled ? 'on' : 'off'}
              onChange={handleRunwayAutomationToggle}
            />
            <p className="mt-2 text-xs text-muted-500">
              {runwayAutomationEnabled
                ? 'Runway In Use and Circuit Direction below are set automatically from SADDS on every capture - the manual buttons are locked. Turn this off to take over manually.'
                : 'Manual control - Runway In Use and Circuit Direction only change when you set them below and click Update Dashboard.'}
            </p>
          </div>
          {parentAirfieldName && (
            <div className="mb-3 max-w-2xl rounded-lg border border-accent-sky-500/30 bg-accent-sky-500/10 px-4 py-3">
              <p className="text-lg font-bold uppercase tracking-wide text-status-bad">Important</p>
              <p className="mt-1 text-base text-status-bad">
                This tenant is linked to <span className="font-semibold">{parentAirfieldName}</span> as its parent
                airfield. The live dashboard shows {parentAirfieldName}&apos;s Runway In Use and Circuit Direction, not
                the selection below - it's still saved here and takes effect immediately if the link is ever removed.
              </p>
            </div>
          )}
          <div className="mb-6 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-panel px-5 py-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-accent-sky-400">
                Runway In Use
              </div>
              <SegmentedToggle
                options={[
                  { value: runwayEnds[0], label: runwayEnds[0] },
                  { value: runwayEnds[1], label: runwayEnds[1] },
                ]}
                value={activeRunwayEnd}
                onChange={handleRunwayEndChange}
                locked={runwayAutomationEnabled}
                lockedMessage="Locked by SADDS Automation - turn off SADDS Automation above to set Runway In Use manually."
              />
              {/* Override, not a replacement for the value above - which
                  end is active stays set underneath while closed, so
                  re-opening doesn't need it re-picked (see runwaysClosed
                  state's own comment). Red when on, matching the
                  "RUNWAYS CLOSED" red the dashboard itself shows. */}
              <label className="mt-3 flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={runwaysClosed}
                  onChange={(event) => setRunwaysClosed(event.target.checked)}
                  className="h-3.5 w-3.5 accent-status-bad"
                />
                <span className={`text-xs font-bold uppercase tracking-widest ${runwaysClosed ? 'text-status-bad' : 'text-muted-400'}`}>
                  Runways Closed
                </span>
              </label>
            </div>
            <div className="rounded-xl border border-border bg-panel px-5 py-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-accent-sky-400">
                Circuit Direction
              </div>
              <SegmentedToggle
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
                value={circuitDirection}
                onChange={handleCircuitDirectionChange}
                locked={runwayAutomationEnabled}
                lockedMessage="Locked by SADDS Automation - turn off SADDS Automation above to set Circuit Direction manually."
              />
            </div>
            <div className="rounded-xl border border-border bg-panel px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-widest text-accent-sky-400">Airfield Info</div>
                <div className="text-xs text-muted-400">
                  {airfieldInfoText.length}/{AIRFIELD_INFO_MAX_LENGTH}
                </div>
              </div>
              <input
                type="text"
                value={airfieldInfoText}
                onChange={handleAirfieldInfoChange}
                maxLength={AIRFIELD_INFO_MAX_LENGTH}
                placeholder="e.g. PPR only after 17:00"
                className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {/* ── Safety notices ───────────────────────────────────────── */}
          <section className="rounded-2xl border border-border bg-panel p-6">
            <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
              Safety Notices
            </div>
            <p className="mb-4 text-xs text-muted-500">
              Appended below the automatic NOTAM feed on the live dashboard - leave a row blank to omit it. Each
              notice's Name is also how it's picked in the Café footer ticker's own slot editor (CAFE MEDIA) -
              notices can be managed from either page, both read and write the same list.
            </p>

            <div className="mb-4">
              <div className="flex flex-wrap items-end gap-6">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-400">
                    Automated NOTAM Feed
                  </div>
                  <SegmentedToggle
                    options={[
                      { value: 'on', label: 'On' },
                      { value: 'off', label: 'Off' },
                    ]}
                    value={showAutoNotams ? 'on' : 'off'}
                    onChange={(v) => setShowAutoNotams(v === 'on')}
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-400">
                    Rotation Interval (sec)
                  </div>
                  <input
                    type="number"
                    min={NOTAMS_INTERVAL_MIN_SECONDS}
                    max={NOTAMS_INTERVAL_MAX_SECONDS}
                    value={notamsIntervalSeconds}
                    onChange={handleNotamsIntervalChange}
                    className="w-24 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-500">
                How often the live dashboard's Ops Panel flips between the runway/circuit/airfield view and the
                NOTAMS view. {NOTAMS_INTERVAL_MIN_SECONDS}-{NOTAMS_INTERVAL_MAX_SECONDS} seconds.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              {safetyNotices.map((notice, index) => (
                <div key={index} className={`flex items-center gap-2 ${notice.enabled ? '' : 'opacity-50'}`}>
                  <span className="w-4 flex-shrink-0 text-right text-xs text-muted-500">{index + 1}</span>
                  <input
                    type="checkbox"
                    checked={notice.enabled}
                    onChange={(event) => handleNoticeEnabledChange(index, event.target.checked)}
                    className="h-3.5 w-3.5 flex-shrink-0"
                    aria-label={`Row ${index + 1} enabled`}
                    title="Enabled"
                  />
                  <SizeSelector value={notice.size} onChange={(size) => handleNoticeSizeChange(index, size)} />
                  <input
                    type="text"
                    value={notice.name ?? ''}
                    onChange={(event) => handleNoticeNameChange(index, event.target.value)}
                    maxLength={SAFETY_NOTICE_NAME_MAX_LENGTH}
                    placeholder="Name (e.g. Bird Activity)"
                    className="w-40 flex-shrink-0 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={notice.text}
                    onChange={(event) => handleNoticeChange(index, event.target.value)}
                    maxLength={SAFETY_NOTICE_MAX_LENGTH}
                    placeholder="e.g. Bird activity near threshold"
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                  <span className="w-10 flex-shrink-0 text-right text-xs text-muted-400">
                    {notice.text.length}/{SAFETY_NOTICE_MAX_LENGTH}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Weather Summary Chart ────────────────────────────────── */}
          <section className="mt-6 rounded-2xl border border-border bg-panel p-6">
            <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
              Weather Summary Chart
            </div>
            <p className="mb-4 text-xs text-muted-500">
              A second, rotating state for Weather Summary showing Shobdon's calculated cloud base and a Met Office
              visibility trend as a chart. Off by default - today's 5 cards stay static until this is turned on.
            </p>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-muted-400">
                  Chart Rotation
                </div>
                <SegmentedToggle
                  options={[
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                  ]}
                  value={weatherSummaryChartEnabled ? 'on' : 'off'}
                  onChange={(v) => setWeatherSummaryChartEnabled(v === 'on')}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-500">
              State A is today's 5 cards (Wind/QNH/Temperature/Cloud Base/Visibility Outlook); State B is the chart.
              Each state's own duration is set in Dashboard Manager's Panel Rotation Timing section, not here.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
