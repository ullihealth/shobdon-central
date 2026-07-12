import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { OPS_PANEL_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'

const AIRFIELD_INFO_MAX_LENGTH = 60
const SAFETY_NOTICE_MAX_LENGTH = 40
const SAFETY_NOTICE_ROWS = 10
const NOTAMS_INTERVAL_MIN_SECONDS = 2
const NOTAMS_INTERVAL_MAX_SECONDS = 30
const NOTAMS_INTERVAL_DEFAULT_SECONDS = 5

type CircuitDirection = 'left' | 'right'
type NoticeSize = 'sm' | 'md' | 'lg'
type ApplyStatus = 'idle' | 'working' | 'success' | 'error'

interface SafetyNotice {
  text: string
  size: NoticeSize
  enabled: boolean
}

const NOTICE_SIZE_OPTIONS: { value: NoticeSize; label: string }[] = [
  { value: 'sm', label: 'Sm' },
  { value: 'md', label: 'Med' },
  { value: 'lg', label: 'Lg' },
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
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/60 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-5 py-1.5 text-sm font-bold uppercase tracking-wide transition ${
            value === option.value ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-white'
          }`}
        >
          {option.label}
        </button>
      ))}
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
  const [showAutoNotams, setShowAutoNotams] = useState(true)
  const [notamsIntervalSeconds, setNotamsIntervalSeconds] = useState(NOTAMS_INTERVAL_DEFAULT_SECONDS)
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')

  useEffect(() => {
    Promise.all([
      fetch(OPS_PANEL_URL).then((response) => (response.ok ? response.json() : null)),
      fetch(PUBLIC_CONFIG_URL).then((response) => (response.ok ? response.json() : null)),
    ]).then(([opsPanel, publicConfig]) => {
      // endAIdentifier/endBIdentifier are admin-typed free text (e.g.
      // "08"/"26"), not a fixed enum - read the two real toggle options
      // rather than assuming which identifiers this tenant actually uses.
      const endA: string | undefined = publicConfig?.runwayGroups?.[0]?.endAIdentifier
      const endB: string | undefined = publicConfig?.runwayGroups?.[0]?.endBIdentifier
      if (endA && endB) setRunwayEnds([endA, endB])

      if (opsPanel) {
        setActiveRunwayEnd(opsPanel.activeRunwayEnd || (endA ?? '08'))
        setCircuitDirection(opsPanel.circuitDirection === 'right' ? 'right' : 'left')
        setAirfieldInfoText(opsPanel.airfieldInfoText ?? '')
        const notices: SafetyNotice[] = Array.isArray(opsPanel.safetyNotices) ? opsPanel.safetyNotices : []
        setSafetyNotices(
          Array.from({ length: SAFETY_NOTICE_ROWS }, (_, i) => notices[i] ?? { text: '', size: 'md', enabled: true })
        )
        setShowAutoNotams(opsPanel.showAutoNotams ?? true)
        setNotamsIntervalSeconds(opsPanel.notamsCarouselIntervalSeconds ?? NOTAMS_INTERVAL_DEFAULT_SECONDS)
      }
      setLoading(false)
    })
  }, [])

  function handleAirfieldInfoChange(event: ChangeEvent<HTMLInputElement>) {
    setAirfieldInfoText(event.target.value.slice(0, AIRFIELD_INFO_MAX_LENGTH))
  }

  function handleNoticeChange(index: number, value: string) {
    setSafetyNotices((prev) =>
      prev.map((n, i) => (i === index ? { ...n, text: value.slice(0, SAFETY_NOTICE_MAX_LENGTH) } : n))
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
  // PUT-then-refresh-trigger flow as /design's "Apply to Live Dashboard"
  // (handleApplyToLiveDashboard) - reusing that exact mechanism rather
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
      const response = await fetch(OPS_PANEL_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeRunwayEnd,
          circuitDirection,
          airfieldInfoText,
          safetyNotices: safetyNotices.filter((n) => n.text.trim().length > 0),
          showAutoNotams,
          notamsCarouselIntervalSeconds: notamsIntervalSeconds,
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
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">ATC Control</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Edit the live Ops Panel. Nothing here reaches the dashboard until you click "Update Dashboard" below -
        toggle and type freely, changes are only staged locally until then.
      </p>

      {loading ? (
        <p className="text-sm text-muted-400">Loading…</p>
      ) : (
        <>
          {/* ── Update dashboard - sticky near the top, not buried at the
              bottom of a long page ─────────────────────────────────── */}
          <div className="sticky top-4 z-20 mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent-sky-500/40 bg-slate-950/95 px-5 py-3 shadow-lg shadow-slate-950/40 backdrop-blur">
            <div>
              <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Update Dashboard</div>
              <p className="text-xs text-muted-500">
                Publishes the staged changes below to the live dashboard - every device that loads it picks them up
                within about 15 seconds.
              </p>
              {applyStatus === 'success' && (
                <p className="mt-1 text-xs font-semibold text-status-good">Published - live dashboard will update shortly.</p>
              )}
              {applyStatus === 'error' && (
                <p className="mt-1 text-xs font-semibold text-status-bad">Failed to publish - check your connection and try again.</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleUpdateDashboard}
              disabled={applyStatus === 'working'}
              className="flex-shrink-0 rounded-lg bg-accent-sky-500 px-6 py-2.5 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {applyStatus === 'working' ? 'Updating…' : 'Update Dashboard'}
            </button>
          </div>

          {/* ── Runway in use + Circuit direction, side by side ──────── */}
          <div className="mb-6 grid grid-cols-2 gap-4">
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
                onChange={setActiveRunwayEnd}
              />
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
                onChange={setCircuitDirection}
              />
            </div>
          </div>

          {/* ── Airfield info ────────────────────────────────────────── */}
          <section className="mb-6 rounded-2xl border border-border bg-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Airfield Info</div>
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
          </section>

          {/* ── Safety notices ───────────────────────────────────────── */}
          <section className="rounded-2xl border border-border bg-panel p-6">
            <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
              Safety Notices
            </div>
            <p className="mb-4 text-xs text-muted-500">
              Appended below the automatic NOTAM feed on the live dashboard - leave a row blank to omit it.
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
        </>
      )}
    </div>
  )
}
