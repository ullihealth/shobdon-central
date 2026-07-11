import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { OPS_PANEL_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'

const AIRFIELD_INFO_MAX_LENGTH = 60
const SAFETY_NOTICE_MAX_LENGTH = 40
const SAFETY_NOTICE_ROWS = 4

type CircuitDirection = 'left' | 'right'
type ApplyStatus = 'idle' | 'working' | 'success' | 'error'

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-2xl border-2 px-6 py-8 text-4xl font-black uppercase tracking-wide transition ${
        active
          ? 'border-accent-sky-500 bg-accent-sky-500/20 text-white'
          : 'border-slate-700 bg-slate-900/60 text-muted-400 hover:border-slate-500'
      }`}
    >
      {label}
    </button>
  )
}

export default function AtcControlPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [runwayEnds, setRunwayEnds] = useState<[string, string]>(['08', '26'])
  const [activeRunwayEnd, setActiveRunwayEnd] = useState('08')
  const [circuitDirection, setCircuitDirection] = useState<CircuitDirection>('left')
  const [airfieldInfoText, setAirfieldInfoText] = useState('')
  const [safetyNotices, setSafetyNotices] = useState<string[]>(Array(SAFETY_NOTICE_ROWS).fill(''))
  const [showAutoNotams, setShowAutoNotams] = useState(true)
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')

  useEffect(() => {
    Promise.all([
      fetch(OPS_PANEL_URL).then((response) => (response.ok ? response.json() : null)),
      fetch(PUBLIC_CONFIG_URL).then((response) => (response.ok ? response.json() : null)),
    ]).then(([opsPanel, publicConfig]) => {
      // runwayGroups[0].label is admin-typed free text (e.g. "08/26"),
      // not a fixed enum - split it to get the two real toggle options
      // rather than assuming which identifiers this tenant actually uses.
      const label: string | undefined = publicConfig?.runwayGroups?.[0]?.label
      const parts = label?.split('/').map((s: string) => s.trim()).filter(Boolean)
      if (parts && parts.length === 2) setRunwayEnds([parts[0], parts[1]])

      if (opsPanel) {
        setActiveRunwayEnd(opsPanel.activeRunwayEnd || (parts?.[0] ?? '08'))
        setCircuitDirection(opsPanel.circuitDirection === 'right' ? 'right' : 'left')
        setAirfieldInfoText(opsPanel.airfieldInfoText ?? '')
        const notices: string[] = Array.isArray(opsPanel.safetyNotices) ? opsPanel.safetyNotices : []
        setSafetyNotices(Array.from({ length: SAFETY_NOTICE_ROWS }, (_, i) => notices[i] ?? ''))
        setShowAutoNotams(opsPanel.showAutoNotams ?? true)
      }
      setLoading(false)
    })
  }, [])

  function handleAirfieldInfoChange(event: ChangeEvent<HTMLInputElement>) {
    setAirfieldInfoText(event.target.value.slice(0, AIRFIELD_INFO_MAX_LENGTH))
  }

  function handleNoticeChange(index: number, value: string) {
    setSafetyNotices((prev) => prev.map((n, i) => (i === index ? value.slice(0, SAFETY_NOTICE_MAX_LENGTH) : n)))
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
          safetyNotices: safetyNotices.filter((n) => n.trim().length > 0),
          showAutoNotams,
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
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-8">
        <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
          ← Back to Config
        </Link>
        <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">ATC Control</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Edit the live Ops Panel. Nothing here reaches the dashboard until you click "Update Dashboard" below -
          toggle and type freely, changes are only staged locally until then.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            {/* ── Runway in use ────────────────────────────────────────── */}
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                Runway In Use
              </div>
              <div className="flex gap-4">
                <ToggleButton
                  label={runwayEnds[0]}
                  active={activeRunwayEnd === runwayEnds[0]}
                  onClick={() => setActiveRunwayEnd(runwayEnds[0])}
                />
                <ToggleButton
                  label={runwayEnds[1]}
                  active={activeRunwayEnd === runwayEnds[1]}
                  onClick={() => setActiveRunwayEnd(runwayEnds[1])}
                />
              </div>
            </section>

            {/* ── Circuit direction ───────────────────────────────────── */}
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                Circuit Direction
              </div>
              <div className="flex gap-4">
                <ToggleButton label="Left" active={circuitDirection === 'left'} onClick={() => setCircuitDirection('left')} />
                <ToggleButton label="Right" active={circuitDirection === 'right'} onClick={() => setCircuitDirection('right')} />
              </div>
            </section>

            {/* ── Airfield info ────────────────────────────────────────── */}
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
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
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                Safety Notices
              </div>
              <p className="mb-4 text-xs text-muted-500">
                Appended below the automatic NOTAM feed on the live dashboard - leave a row blank to omit it.
              </p>

              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-400">
                  Automated NOTAM Feed
                </div>
                <div className="flex gap-4">
                  <ToggleButton label="On" active={showAutoNotams} onClick={() => setShowAutoNotams(true)} />
                  <ToggleButton label="Off" active={!showAutoNotams} onClick={() => setShowAutoNotams(false)} />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {safetyNotices.map((notice, index) => (
                  <div key={index}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                        Row {index + 1}
                      </span>
                      <span className="text-xs text-muted-400">
                        {notice.length}/{SAFETY_NOTICE_MAX_LENGTH}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={notice}
                      onChange={(event) => handleNoticeChange(index, event.target.value)}
                      maxLength={SAFETY_NOTICE_MAX_LENGTH}
                      placeholder="e.g. Bird activity near threshold"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* ── Update dashboard ─────────────────────────────────────── */}
            <section className="rounded-2xl border border-border bg-panel p-6">
              <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                Update Dashboard
              </div>
              <p className="mb-4 text-xs text-muted-500">
                Publishes the staged changes above to the live dashboard - every device that loads it picks them up
                within about 15 seconds.
              </p>
              <button
                type="button"
                onClick={handleUpdateDashboard}
                disabled={applyStatus === 'working'}
                className="rounded-lg bg-accent-sky-500 px-6 py-3 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
              >
                {applyStatus === 'working' ? 'Updating…' : 'Update Dashboard'}
              </button>
              {applyStatus === 'success' && (
                <p className="mt-3 text-sm font-semibold text-status-good">Published - live dashboard will update shortly.</p>
              )}
              {applyStatus === 'error' && (
                <p className="mt-3 text-sm font-semibold text-status-bad">Failed to publish - check your connection and try again.</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
