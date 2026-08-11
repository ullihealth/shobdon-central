import { useEffect, useState } from 'react'
import type { TickerSlot, TickerSlotType } from '../CafeTicker'
import { DEFAULT_TICKER_STYLE } from '../pilot/PilotFooterTicker'
import TickerEmojiTextInput from '../TickerEmojiTextInput'

// Platform-admin editor for a specific tenant's Pilot View sticky
// ticker (migration 0070, tenants.pilot_ticker_slots_json). Mirrors
// TickerSettingsCards.tsx's café-ticker editor UI directly - same
// numbered-row / type-select / Text-override / On-checkbox shape,
// same slotOptionValue encoding trick - but against a genuinely
// separate per-tenant config (own route, own slot count) rather than
// that component's cafe_template_settings row. Pilot View's overall
// ticker style (background/height/speed/etc) is still fixed, not
// per-tenant configurable - but each slot can now override its own
// text colour, same as the café ticker editor, falling back to
// PilotFooterTicker.tsx's own DEFAULT_TICKER_STYLE.fontColor when unset.
const PILOT_TICKER_SLOT_COUNT = 8

interface SafetyNotice {
  id?: string
  name?: string
  text: string
  size: string
  enabled: boolean
}

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

function slotOptionValue(slot: TickerSlot): string {
  if (slot.type === 'notice') return `notice:${slot.noticeId ?? ''}`
  return slot.type ?? ''
}

function parseSlotOptionValue(value: string): Partial<TickerSlot> {
  if (value.startsWith('notice:')) return { type: 'notice', noticeId: value.slice('notice:'.length) }
  return { type: (value || null) as TickerSlotType | null, noticeId: undefined }
}

function buildSlotOptions(notices: SafetyNotice[]): { value: string; label: string }[] {
  return [
    { value: '', label: '— None —' },
    { value: 'clock', label: 'Clock / Date' },
    { value: 'forecast', label: '6-Hour Met Office Forecast' },
    { value: 'conditions', label: 'Current Conditions (Temp / Wind)' },
    { value: 'fuel', label: 'Fuel Prices' },
    ...notices.map((notice, index) => ({
      value: `notice:${notice.id ?? index}`,
      label: `Notice: ${notice.name || notice.text}${notice.enabled === false ? ' (off)' : ''}`,
    })),
  ]
}

function defaultTickerSlots(): TickerSlot[] {
  return Array.from({ length: PILOT_TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true }))
}

export default function PilotTickerSlotsEditor({ tenantId }: { tenantId: number }): JSX.Element | null {
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>(defaultTickerSlots())
  const [notices, setNotices] = useState<SafetyNotice[]>([])
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/platform/tenants/${tenantId}/pilot-view`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.tickerSlots) && data.tickerSlots.length === PILOT_TICKER_SLOT_COUNT) {
          setTickerSlots(data.tickerSlots)
        }
        if (Array.isArray(data.notices)) setNotices(data.notices)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tenantId])

  function updateSlot(position: number, patch: Partial<TickerSlot>) {
    setTickerSlots((prev) => prev.map((slot) => (slot.position === position ? { ...slot, ...patch } : slot)))
  }

  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch(`/api/platform/tenants/${tenantId}/pilot-view`, {
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
    <section className="mt-4 rounded-2xl border border-border bg-panel p-6">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={expanded}
      >
        <div>
          <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Pilot View Ticker</div>
          <p className="mt-1 text-xs text-muted-500">
            Sticky scrolling strip shown at the bottom of this tenant's /pilot page.
          </p>
        </div>
        <span
          className={`shrink-0 text-lg text-muted-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="mt-4">
          {loading ? (
            <p className="text-xs text-muted-500">Loading…</p>
          ) : (
            <>
              <p className="mb-4 text-xs text-muted-500">
                Up to {PILOT_TICKER_SLOT_COUNT} slots, each set to a content type and independently switched
                on/off. Check "Text" on a slot to type a custom message instead of the dropdown's content.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tickerSlots.map((slot) => (
                  <div key={slot.position} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-xs font-bold text-muted-500">{slot.position}.</span>
                      <select
                        value={slotOptionValue(slot)}
                        onChange={(event) => updateSlot(slot.position, parseSlotOptionValue(event.target.value))}
                        disabled={!!slot.textMode}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {buildSlotOptions(notices).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <label
                        className="flex shrink-0 cursor-pointer items-center gap-1.5"
                        title="Type a custom message for this slot instead of the dropdown's content"
                      >
                        <input
                          type="checkbox"
                          checked={!!slot.textMode}
                          onChange={(event) => updateSlot(slot.position, { textMode: event.target.checked })}
                          className="h-4 w-4 accent-accent-sky-500"
                        />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-500">Text</span>
                      </label>
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5" title="Enable this slot">
                        <input
                          type="checkbox"
                          checked={slot.enabled !== false}
                          onChange={(event) => updateSlot(slot.position, { enabled: event.target.checked })}
                          className="h-4 w-4 accent-accent-sky-500"
                        />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-500">On</span>
                      </label>
                      <div
                        className="flex shrink-0 items-center gap-1"
                        title="This slot's own text colour (overrides the ticker's default colour)"
                      >
                        <input
                          type="color"
                          value={slot.textColor ?? DEFAULT_TICKER_STYLE.fontColor}
                          onChange={(event) => updateSlot(slot.position, { textColor: event.target.value })}
                          className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent"
                        />
                        {slot.textColor && (
                          <button
                            type="button"
                            onClick={() => updateSlot(slot.position, { textColor: undefined })}
                            className="text-[11px] font-semibold text-muted-500 hover:text-status-bad"
                            title="Reset to the ticker's default colour"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                    {slot.textMode && (
                      <TickerEmojiTextInput
                        value={slot.manualText ?? ''}
                        onChange={(value) => updateSlot(slot.position, { manualText: value })}
                        placeholder="Type this slot's message…"
                        className="ml-8 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saveStatus === 'working'}
                  className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveStatus === 'working' ? 'Saving…' : 'Save Pilot Ticker'}
                </button>
                {saveStatus === 'success' && <span className="text-sm font-semibold text-status-good">Saved.</span>}
                {saveStatus === 'error' && <span className="text-sm font-semibold text-status-bad">Couldn't save.</span>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
