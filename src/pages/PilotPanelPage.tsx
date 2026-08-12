import { useEffect, useState } from 'react'
import type { TickerSlot } from '../components/CafeTicker'
import PilotTickerSlotsCards, { PILOT_TICKER_SLOT_COUNT } from '../components/media/PilotTickerSlotsCards'

// Settings > Pilot Panel - configures the /pilot mobile view's own
// ticker and background, independently of the desktop dashboard's
// Dashboard Manager. Owns the draft state for both sections at this
// top level (rather than each section being self-contained like
// TickerSettingsCards.tsx/PilotTickerSlotsEditor.tsx) specifically so
// the live phone-frame preview (a later piece) can read the same
// in-progress, not-yet-saved state the editors below are mutating.
type SaveStatus = 'idle' | 'working' | 'success' | 'error'

function defaultTickerSlots(): TickerSlot[] {
  return Array.from({ length: PILOT_TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true }))
}

export default function PilotPanelPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>(defaultTickerSlots())
  const [desktopTickerSlots, setDesktopTickerSlots] = useState<TickerSlot[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/pilot-view')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.tickerSlots) && data.tickerSlots.length === PILOT_TICKER_SLOT_COUNT) {
          setTickerSlots(data.tickerSlots)
        }
        if (Array.isArray(data.desktopTickerSlots)) setDesktopTickerSlots(data.desktopTickerSlots)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch('/api/tenant/pilot-view', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickerSlots }),
      })
      setSaveStatus(response.ok ? 'success' : 'error')
    } catch {
      setSaveStatus('error')
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold text-primary">Pilot Panel</h1>
      <p className="mt-2 text-sm text-muted-400">
        Configure the /pilot mobile view's ticker and background, independently of the desktop dashboard.
      </p>

      {loading ? (
        <p className="mt-6 text-xs text-muted-500">Loading…</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <PilotTickerSlotsCards slots={tickerSlots} onChange={setTickerSlots} desktopTickerSlots={desktopTickerSlots} />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'working'}
              className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveStatus === 'working' ? 'Saving…' : 'Save Pilot Panel'}
            </button>
            {saveStatus === 'success' && <span className="text-sm font-semibold text-status-good">Saved.</span>}
            {saveStatus === 'error' && <span className="text-sm font-semibold text-status-bad">Couldn't save.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
