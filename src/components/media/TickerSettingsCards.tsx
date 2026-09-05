import { useEffect, useState } from 'react'
import type { TickerSlot, TickerSlotType, TickerStyle } from '../CafeTicker'
import TickerEmojiTextInput from '../TickerEmojiTextInput'
import {
  BUILT_IN_TICKER_PRESETS,
  DEFAULT_TICKER_STYLE,
  loadTickerStyleTemplates,
  saveTickerStyleTemplates,
  type TickerStyleTemplate,
} from '../../services/tickerStyleStore'

// Extracted from CafeMediaPage.tsx (Footer Ticker + Ticker Style used to
// live inline there, café-only) - now free/universal for every tenant,
// a deliberate reduction in what the café-tv paid bundle uniquely
// offers, not an oversight. Genuinely self-contained: fetches its own
// cafe_template_settings row and its own notices list, and saves
// independently of whatever page it's dropped into - no props needed,
// no coordination with the host page's own save action. Rendered on
// MediaManagerPage.tsx (every tenant) - deliberately NOT rendered on
// CafeMediaPage.tsx anymore, so there's exactly one editing surface for
// this data, not two. CafeMediaPage.tsx keeps its own read-only copy of
// tickerEnabled/tickerSlots/tickerStyle (fetched the same way, from the
// same endpoint) purely so its live preview still shows what the café
// screen actually looks like, ticker included.
//
// Data still lives in cafe_template_settings (organizationId PRIMARY
// KEY, one row per tenant regardless of café status - confirmed
// working for any tenant via the same INSERT ... ON CONFLICT upsert
// this file's own PUT already uses) - NOT renamed this round. The name
// is now a misnomer for what's actually inside (ticker config isn't
// café-specific data anymore, even though layoutMode/adLabelEnabled in
// the same table still are) - flagging this for whoever touches this
// table next, not fixing it now.
const CAFE_SETTINGS_URL = '/api/tenant/cafe-settings'
const OPS_PANEL_URL = '/api/tenant/ops-panel'
const TICKER_SLOT_COUNT = 10
const FONT_FAMILY_OPTIONS: TickerStyle['fontFamily'][] = ['Inter', 'Montserrat', 'Oswald']

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

// Same shape as ops-panel/index.ts's own SafetyNoticeStored and every
// other page-local copy of it (AtcControlPage.tsx, CafeMediaPage.tsx's
// own Notices section) - this IS that same data, read through the same
// /api/tenant/ops-panel endpoint every one of those already uses, not a
// parallel store. Read-only here (no CRUD) - notices are managed via
// ATC Control (owner/admin/atc), already universal/not café-gated;
// this component only needs the list to populate a slot's dropdown.
interface SafetyNotice {
  id: string
  name: string
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

// A slot's <select> value is a plain string encoding both `type` and,
// for notices, WHICH one - '' | 'clock' | 'forecast' | 'conditions' |
// `notice:${id}`. Keeps the dropdown a single native <select> (one
// onChange, no separate "which notice" sub-control to keep in sync)
// while still letting each slot reference one specific notice.
function slotOptionValue(slot: TickerSlot): string {
  if (slot.type === 'notice') return `notice:${slot.noticeId ?? ''}`
  return slot.type ?? ''
}

function parseSlotOptionValue(value: string): Partial<TickerSlot> {
  if (value.startsWith('notice:')) return { type: 'notice', noticeId: value.slice('notice:'.length) }
  return { type: (value || null) as TickerSlotType | null, noticeId: undefined }
}

// Base types plus one option per EXISTING notice - all notices are
// listed regardless of their own enabled state (a slot can be pre-wired
// to a currently-off notice, ready for later) - the "(off)" suffix
// makes that visible rather than silently confusing. 'fuel' - previously
// an additive "Fuel" checkbox alongside this dropdown (task #42) - is
// now one of the dropdown's own options, same as every other built-in
// type; the checkbox's old UI position is now the "Text" toggle below
// instead (manual per-slot text, an either/or with this dropdown, not
// additive).
function buildSlotOptions(notices: SafetyNotice[]): { value: string; label: string }[] {
  return [
    { value: '', label: '— None —' },
    { value: 'clock', label: 'Clock / Date' },
    { value: 'forecast', label: '6-Hour Met Office Forecast' },
    { value: 'conditions', label: 'Current Conditions (Temp / Wind)' },
    { value: 'fuel', label: 'Fuel Prices' },
    { value: 'sunriseSunset', label: 'Sunrise / Sunset' },
    ...notices.map((notice) => ({
      value: `notice:${notice.id}`,
      label: `Notice: ${notice.name || notice.text}${notice.enabled === false ? ' (off)' : ''}`,
    })),
  ]
}

function defaultTickerSlots(): TickerSlot[] {
  return Array.from({ length: TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true }))
}

// Same ticker* wire-format field names cafe-settings/index.ts uses -
// CafeTicker's own TickerStyle prop is deliberately unprefixed.
function tickerStyleFromApi(data: Record<string, unknown>): TickerStyle {
  return {
    backgroundColor: (data.tickerBackgroundColor as string) ?? DEFAULT_TICKER_STYLE.backgroundColor,
    backgroundOpacity: (data.tickerBackgroundOpacity as number) ?? DEFAULT_TICKER_STYLE.backgroundOpacity,
    heightPx: (data.tickerHeightPx as number) ?? DEFAULT_TICKER_STYLE.heightPx,
    fontFamily: (data.tickerFontFamily as TickerStyle['fontFamily']) ?? DEFAULT_TICKER_STYLE.fontFamily,
    fontSizePx: (data.tickerFontSizePx as number) ?? DEFAULT_TICKER_STYLE.fontSizePx,
    fontColor: (data.tickerFontColor as string) ?? DEFAULT_TICKER_STYLE.fontColor,
    scrollSpeedPxPerSec: (data.tickerScrollSpeedPxPerSec as number) ?? DEFAULT_TICKER_STYLE.scrollSpeedPxPerSec,
    gapPx: (data.tickerGapPx as number) ?? DEFAULT_TICKER_STYLE.gapPx,
  }
}

function tickerStyleToApi(style: TickerStyle): Record<string, unknown> {
  return {
    tickerBackgroundColor: style.backgroundColor,
    tickerBackgroundOpacity: style.backgroundOpacity,
    tickerHeightPx: style.heightPx,
    tickerFontFamily: style.fontFamily,
    tickerFontSizePx: style.fontSizePx,
    tickerFontColor: style.fontColor,
    tickerScrollSpeedPxPerSec: style.scrollSpeedPxPerSec,
    tickerGapPx: style.gapPx,
  }
}

export default function TickerSettingsCards(): JSX.Element | null {
  const [loading, setLoading] = useState(true)
  const [tickerEnabled, setTickerEnabled] = useState(false)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>(defaultTickerSlots())
  const [tickerStyle, setTickerStyle] = useState<TickerStyle>(DEFAULT_TICKER_STYLE)
  const [notices, setNotices] = useState<SafetyNotice[]>([])
  const [styleExpanded, setStyleExpanded] = useState(false)
  const [customTemplates, setCustomTemplates] = useState<TickerStyleTemplate[]>(() => loadTickerStyleTemplates())
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    let cancelled = false

    const settingsLoaded = fetch(CAFE_SETTINGS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setTickerEnabled(!!data.tickerEnabled)
        if (Array.isArray(data.tickerSlots) && data.tickerSlots.length === TICKER_SLOT_COUNT) {
          setTickerSlots(data.tickerSlots.map((slot: TickerSlot) => ({ ...slot, enabled: slot.enabled !== false })))
        }
        setTickerStyle(tickerStyleFromApi(data))
      })
      .catch(() => {})

    // A 'media'-role user can reach Dashboard Manager but not
    // /api/tenant/ops-panel (owner/admin/atc/cafe only) - fails closed
    // to an empty notices list (same posture as every other resilient
    // fetch in this codebase) rather than breaking the rest of the
    // page; the slot dropdown just offers clock/forecast/conditions/
    // none for that role, not notices.
    const noticesLoaded = fetch(OPS_PANEL_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.safetyNotices)) setNotices(data.safetyNotices)
      })
      .catch(() => {})

    Promise.all([settingsLoaded, noticesLoaded]).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  function updateSlot(position: number, patch: Partial<TickerSlot>) {
    setTickerSlots((prev) => prev.map((slot) => (slot.position === position ? { ...slot, ...patch } : slot)))
  }

  function updateStyle(patch: Partial<TickerStyle>) {
    setTickerStyle((prev) => ({ ...prev, ...patch }))
  }

  function applyPreset(style: TickerStyle) {
    setTickerStyle(style)
  }

  function handleSaveAsTemplate() {
    const name = templateNameInput.trim()
    if (!name) return
    const next: TickerStyleTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      style: tickerStyle,
      createdAt: new Date().toISOString(),
    }
    const updated = [...customTemplates, next]
    setCustomTemplates(updated)
    saveTickerStyleTemplates(updated)
    setTemplateNameInput('')
  }

  function handleDeleteTemplate(id: string) {
    const updated = customTemplates.filter((t) => t.id !== id)
    setCustomTemplates(updated)
    saveTickerStyleTemplates(updated)
  }

  // Sends ONLY ticker fields - cafe-settings' own PUT is a fetch-
  // current-merge-write-back (each field falls back to whatever's
  // already stored if omitted), so this never touches layoutMode/
  // adLabelEnabled, which CafeMediaPage.tsx's own remaining Save
  // Settings button still owns independently. Two separate save
  // actions on two different pages, same row, no conflict - confirmed
  // safe by how that merge already works today.
  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch(CAFE_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickerEnabled,
          tickerSlots,
          ...tickerStyleToApi(tickerStyle),
        }),
      })
      setSaveStatus(response.ok ? 'success' : 'error')
    } catch {
      setSaveStatus('error')
    }
  }

  if (loading) return null

  return (
    <>
      {/* TICKER STYLE - collapsible accordion, defaults collapsed:
          styling (colour/font/speed/gap) is a "set once via a preset,
          rarely revisit" section, unlike the slot content editor below
          it, which is what most visits are actually here to change. */}
      <section className="mt-8 rounded-2xl border border-border bg-panel p-6">
        <button
          type="button"
          onClick={() => setStyleExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between text-left"
          aria-expanded={styleExpanded}
        >
          <div>
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Ticker Style</div>
            <p className="mt-1 text-xs text-muted-500">
              Background, text, and scroll-speed appearance for the footer ticker.
            </p>
          </div>
          <span
            className={`shrink-0 text-lg text-muted-400 transition-transform ${styleExpanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>

        {styleExpanded && (
          <div className="mt-4">
            <p className="mb-4 text-xs text-muted-500">Pick a preset below as a starting point, then fine-tune anything here.</p>

            <div className="mb-6">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-400">Presets</div>
              <div className="flex flex-wrap gap-2">
                {BUILT_IN_TICKER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.style)}
                    className="flex items-center gap-2 rounded-lg border border-border bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500"
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-white/20"
                      style={{ backgroundColor: preset.style.backgroundColor }}
                    />
                    {preset.name}
                  </button>
                ))}
                {customTemplates.map((template) => (
                  <div
                    key={template.id}
                    className="flex items-center gap-1 rounded-lg border border-border bg-slate-900/80 pl-1 pr-2 text-xs font-semibold text-slate-200"
                  >
                    <button
                      type="button"
                      onClick={() => applyPreset(template.style)}
                      className="flex items-center gap-2 rounded-md px-2 py-2 transition hover:text-accent-sky-400"
                    >
                      <span
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: template.style.backgroundColor }}
                      />
                      {template.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(template.id)}
                      className="text-muted-500 hover:text-status-bad"
                      title="Delete this saved template"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-400">Background colour</span>
                <input
                  type="color"
                  value={tickerStyle.backgroundColor}
                  onChange={(event) => updateStyle({ backgroundColor: event.target.value })}
                  className="h-9 w-full cursor-pointer rounded border border-border bg-transparent"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-400">Background opacity ({tickerStyle.backgroundOpacity}%)</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={tickerStyle.backgroundOpacity}
                  onChange={(event) => updateStyle({ backgroundOpacity: Number(event.target.value) })}
                  className="accent-accent-sky-500"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-400">Height (px)</span>
                <input
                  type="number"
                  min={24}
                  max={200}
                  value={tickerStyle.heightPx}
                  onChange={(event) => updateStyle({ heightPx: Number(event.target.value) })}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-400">Font family</span>
                <select
                  value={tickerStyle.fontFamily}
                  onChange={(event) => updateStyle({ fontFamily: event.target.value as TickerStyle['fontFamily'] })}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                >
                  {FONT_FAMILY_OPTIONS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-400">Font size (px)</span>
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={tickerStyle.fontSizePx}
                  onChange={(event) => updateStyle({ fontSizePx: Number(event.target.value) })}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-400">Font colour</span>
                <input
                  type="color"
                  value={tickerStyle.fontColor}
                  onChange={(event) => updateStyle({ fontColor: event.target.value })}
                  className="h-9 w-full cursor-pointer rounded border border-border bg-transparent"
                />
              </label>

              <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <span className="text-xs uppercase tracking-wide text-muted-400">
                  Scroll speed ({tickerStyle.scrollSpeedPxPerSec === 0 ? 'Static - no scrolling' : `${tickerStyle.scrollSpeedPxPerSec} px/sec`})
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={tickerStyle.scrollSpeedPxPerSec}
                  onChange={(event) => updateStyle({ scrollSpeedPxPerSec: Number(event.target.value) })}
                  className="accent-accent-sky-500"
                />
              </label>

              <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <span className="text-xs uppercase tracking-wide text-muted-400">
                  Gap between messages ({tickerStyle.gapPx === 0 ? 'Tight (default)' : `${tickerStyle.gapPx}px`})
                </span>
                <input
                  type="range"
                  min={0}
                  max={2000}
                  value={tickerStyle.gapPx}
                  onChange={(event) => updateStyle({ gapPx: Number(event.target.value) })}
                  className="accent-accent-sky-500"
                />
                <span className="text-[11px] text-muted-500">
                  At the high end, one message fully scrolls off-screen before the next appears - that blank moment
                  is expected, not a bug.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <input
                value={templateNameInput}
                onChange={(event) => setTemplateNameInput(event.target.value)}
                placeholder="New template name"
                className="rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
              />
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                disabled={!templateNameInput.trim()}
                className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save as template
              </button>
            </div>
          </div>
        )}
      </section>

      {/* FOOTER TICKER - directly beneath Ticker Style, same order as
          CafeMediaPage.tsx used to have it. */}
      <section className="mt-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Footer Ticker</div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={tickerEnabled}
              onChange={(event) => setTickerEnabled(event.target.checked)}
              className="h-5 w-5 accent-accent-sky-500"
            />
            <span className="text-sm font-semibold text-primary">{tickerEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="mb-4 text-xs text-muted-500">
          A continuous scrolling strip across the bottom of the screen. Up to 10 slots, each set to a content
          type and independently switched on/off - pick a specific named notice from ATC Control's Safety
          Notices section (different slots can show different notices), or "Fuel Prices" to show the Fuel
          Prices container's values (below). Check "Text" on a slot to type your own message instead - Text
          replaces whatever the dropdown would otherwise show for that slot, not both at once. A slot's own
          toggles only matter while the master toggle above is on.
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
                  title="Type your own message for this slot instead - replaces whatever the dropdown would otherwise show, not both at once"
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
                {/* Per-slot text colour - independent of the whole
                    ticker's own Font colour above (Ticker Style
                    section), and applies regardless of Text mode - a
                    dropdown-content slot (clock/forecast/notice/etc.)
                    can be recoloured exactly the same way as a free-text
                    one. Swatch shows the ticker's own Font colour while
                    this slot has no override of its own (implying "this
                    slot is currently inheriting that colour"), same
                    convention as every other colour input on this page -
                    only actually WRITES textColor once the admin
                    interacts with it. The small × only appears once a
                    real override exists, so there's a way back to
                    "inherit the ticker's own colour" without having to
                    manually match its hex value by eye. */}
                <div className="flex shrink-0 items-center gap-1" title="This slot's own text colour (overrides the ticker's Font colour above)">
                  <input
                    type="color"
                    value={slot.textColor ?? tickerStyle.fontColor}
                    onChange={(event) => updateSlot(slot.position, { textColor: event.target.value })}
                    className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent"
                  />
                  {slot.textColor && (
                    <button
                      type="button"
                      onClick={() => updateSlot(slot.position, { textColor: undefined })}
                      className="text-[11px] font-semibold text-muted-500 hover:text-status-bad"
                      title="Reset to the ticker's own Font colour"
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
            {saveStatus === 'working' ? 'Saving…' : 'Save Ticker Settings'}
          </button>
          {saveStatus === 'success' && <span className="text-sm font-semibold text-status-good">Saved.</span>}
          {saveStatus === 'error' && <span className="text-sm font-semibold text-status-bad">Couldn't save.</span>}
        </div>
      </section>
    </>
  )
}
