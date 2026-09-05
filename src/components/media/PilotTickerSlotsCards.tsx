import { useEffect, useState } from 'react'
import type { TickerSlot, TickerSlotType } from '../CafeTicker'
import { DEFAULT_TICKER_STYLE } from '../pilot/PilotFooterTicker'
import TickerEmojiTextInput from '../TickerEmojiTextInput'

// Pilot Panel's own ticker-slot editor (src/pages/PilotPanelPage.tsx) -
// same row UI as the platform-admin's PilotTickerSlotsEditor.tsx
// (src/components/platform/), not shared with it: that component still
// serves PlatformTenantsPage.tsx's cross-tenant editor (explicit
// tenantId prop, requirePlatformAdmin), a genuinely different auth
// context from this tenant-self-service page. Controlled, not
// self-contained like its platform sibling - PilotPanelPage.tsx owns
// `slots` state so its live phone-frame preview can read the same
// in-progress draft this editor is mutating, before anything is saved.
export const PILOT_TICKER_SLOT_COUNT = 8

interface SafetyNotice {
  id?: string
  name?: string
  text: string
  size: string
  enabled: boolean
}

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
    { value: 'sunriseSunset', label: 'Sunrise / Sunset' },
    ...notices.map((notice, index) => ({
      value: `notice:${notice.id ?? index}`,
      label: `Notice: ${notice.name || notice.text}${notice.enabled === false ? ' (off)' : ''}`,
    })),
  ]
}

// Desktop's café ticker has 10 slots, Pilot's has 8 - a straight copy
// would break the "exactly PILOT_TICKER_SLOT_COUNT entries" invariant
// the backend validates. Takes positions 1-8 from the desktop array
// (whatever's actually configured there, matched by position - not
// just the first 8 array entries, in case of gaps), dropping 9/10 and
// defaulting any missing position to empty/on - the same shape
// defaultTickerSlots() below already produces for a brand-new tenant.
function copyFromDesktop(desktopSlots: TickerSlot[]): TickerSlot[] {
  return Array.from({ length: PILOT_TICKER_SLOT_COUNT }, (_, i) => {
    const position = i + 1
    const match = desktopSlots.find((slot) => slot.position === position)
    return match ? { ...match, position } : { position, type: null, enabled: true }
  })
}

interface PilotTickerSlotsCardsProps {
  slots: TickerSlot[]
  onChange: (slots: TickerSlot[]) => void
  desktopTickerSlots: TickerSlot[]
}

export default function PilotTickerSlotsCards({ slots, onChange, desktopTickerSlots }: PilotTickerSlotsCardsProps): JSX.Element {
  const [notices, setNotices] = useState<SafetyNotice[]>([])

  // Read-only, for the notice-slot dropdown only - same endpoint
  // TickerSettingsCards.tsx's own desktop editor already uses for this
  // exact purpose (owner/admin/atc/cafe allowed), not a new source.
  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/ops-panel')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.safetyNotices)) setNotices(data.safetyNotices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function updateSlot(position: number, patch: Partial<TickerSlot>) {
    onChange(slots.map((slot) => (slot.position === position ? { ...slot, ...patch } : slot)))
  }

  return (
    <section className="rounded-2xl border border-border bg-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Pilot Ticker</div>
          <p className="mt-1 text-xs text-muted-500">
            Sticky scrolling strip shown at the bottom of this tenant's /pilot page. Independent of the desktop ticker.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(copyFromDesktop(desktopTickerSlots))}
          className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-sky-500"
          title="Copies the desktop ticker's first 8 slots into this form - a one-time copy, not a live link. Overwrites the slots below; not saved until you press Save."
        >
          Copy from desktop ticker
        </button>
      </div>

      <p className="mb-4 mt-4 text-xs text-muted-500">
        Up to {PILOT_TICKER_SLOT_COUNT} slots, each set to a content type and independently switched on/off. Check "Text"
        on a slot to type a custom message instead of the dropdown's content.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {slots.map((slot) => (
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
    </section>
  )
}
