import { useEffect, useState } from 'react'
import type { TickerStyle } from '../CafeTicker'
import { BUILT_IN_TICKER_PRESETS } from '../../services/tickerStyleStore'

// Pilot Panel's own ticker-style editor (src/pages/PilotPanelPage.tsx) -
// same style controls as the desktop TickerSettingsCards.tsx's "Ticker
// Style" section, copy-adapted (no shared field components exist to
// import - confirmed in investigation). Controlled, not self-contained,
// matching PilotTickerSlotsCards.tsx's own pattern: PilotPanelPage.tsx
// owns tickerStyle state so the live phone-frame preview can read the
// same in-progress draft this editor mutates.
//
// Custom templates ARE real, direct network calls from this component
// (unlike the built-in presets below, which are pure client-side
// "apply" with nothing to fetch) - server-persisted per tenant via
// /api/tenant/pilot-ticker-style-templates, not localStorage like the
// desktop ticker's own tickerStyleStore.ts custom templates. Deliberate
// deviation, confirmed against the design_templates precedent (Screens
// Design's own template library, which made the exact same
// localStorage -> server move after confirming the browser-local
// version never reached a tenant's real account).
const TEMPLATES_URL = '/api/tenant/pilot-ticker-style-templates'
const FONT_FAMILY_OPTIONS: TickerStyle['fontFamily'][] = ['Inter', 'Montserrat', 'Oswald']
// Capped at 200 here, not desktop's 500 - matches
// TickerSettingsCards.tsx's own UI slider cap, per Pilot Panel's
// confirmed scope decision; the desktop endpoint's wider 500 stays
// untouched.
const MAX_SCROLL_SPEED = 200
const MAX_NAME_LENGTH = 60

interface StyleTemplate {
  id: string
  name: string
  style: TickerStyle
  createdAt: string
}

interface PilotTickerStyleCardsProps {
  style: TickerStyle
  onChange: (style: TickerStyle) => void
}

export default function PilotTickerStyleCards({ style, onChange }: PilotTickerStyleCardsProps): JSX.Element {
  const [templates, setTemplates] = useState<StyleTemplate[]>([])
  const [templateNameInput, setTemplateNameInput] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(TEMPLATES_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.templates)) setTemplates(data.templates)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function updateStyle(patch: Partial<TickerStyle>) {
    onChange({ ...style, ...patch })
  }

  async function handleSaveAsTemplate() {
    const name = templateNameInput.trim()
    if (!name) return
    setTemplateSaving(true)
    setTemplateError(null)
    try {
      const response = await fetch(TEMPLATES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, style }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setTemplateError(body?.error ?? "Couldn't save template")
        return
      }
      const created: StyleTemplate = await response.json()
      setTemplates((prev) => [...prev, created])
      setTemplateNameInput('')
    } catch {
      setTemplateError("Couldn't save template")
    } finally {
      setTemplateSaving(false)
    }
  }

  async function handleDeleteTemplate(id: string) {
    const previous = templates
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    try {
      const response = await fetch(`${TEMPLATES_URL}/${id}`, { method: 'DELETE' })
      if (!response.ok) setTemplates(previous)
    } catch {
      setTemplates(previous)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-panel p-6">
      <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Pilot Ticker Style</div>
      <p className="mt-1 text-xs text-muted-500">
        Background, text, and scroll-speed appearance for the /pilot ticker. Independent of the desktop ticker's own
        style.
      </p>

      <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-400">Presets</div>
      <div className="mb-6 flex flex-wrap gap-2">
        {BUILT_IN_TICKER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.style)}
            className="flex items-center gap-2 rounded-lg border border-border bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500"
          >
            <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: preset.style.backgroundColor }} />
            {preset.name}
          </button>
        ))}
        {templates.map((template) => (
          <div
            key={template.id}
            className="flex items-center gap-1 rounded-lg border border-border bg-slate-900/80 pl-1 pr-2 text-xs font-semibold text-slate-200"
          >
            <button
              type="button"
              onClick={() => onChange(template.style)}
              className="flex items-center gap-2 rounded-md px-2 py-2 transition hover:text-accent-sky-400"
            >
              <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: template.style.backgroundColor }} />
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-400">Background colour</span>
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(event) => updateStyle({ backgroundColor: event.target.value })}
            className="h-9 w-full cursor-pointer rounded border border-border bg-transparent"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-400">Background opacity ({style.backgroundOpacity}%)</span>
          <input
            type="range"
            min={0}
            max={100}
            value={style.backgroundOpacity}
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
            value={style.heightPx}
            onChange={(event) => updateStyle({ heightPx: Number(event.target.value) })}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-400">Font family</span>
          <select
            value={style.fontFamily}
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
            value={style.fontSizePx}
            onChange={(event) => updateStyle({ fontSizePx: Number(event.target.value) })}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-400">Font colour</span>
          <input
            type="color"
            value={style.fontColor}
            onChange={(event) => updateStyle({ fontColor: event.target.value })}
            className="h-9 w-full cursor-pointer rounded border border-border bg-transparent"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          <span className="text-xs uppercase tracking-wide text-muted-400">
            Scroll speed ({style.scrollSpeedPxPerSec === 0 ? 'Static - no scrolling' : `${style.scrollSpeedPxPerSec} px/sec`})
          </span>
          <input
            type="range"
            min={0}
            max={MAX_SCROLL_SPEED}
            value={style.scrollSpeedPxPerSec}
            onChange={(event) => updateStyle({ scrollSpeedPxPerSec: Number(event.target.value) })}
            className="accent-accent-sky-500"
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
          <span className="text-xs uppercase tracking-wide text-muted-400">
            Gap between messages ({style.gapPx === 0 ? 'Tight (default)' : `${style.gapPx}px`})
          </span>
          <input
            type="range"
            min={0}
            max={2000}
            value={style.gapPx}
            onChange={(event) => updateStyle({ gapPx: Number(event.target.value) })}
            className="accent-accent-sky-500"
          />
          <span className="text-[11px] text-muted-500">
            At the high end, one message fully scrolls off-screen before the next appears - that blank moment is
            expected, not a bug.
          </span>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <input
          value={templateNameInput}
          onChange={(event) => setTemplateNameInput(event.target.value)}
          placeholder="New template name"
          maxLength={MAX_NAME_LENGTH}
          className="rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
        />
        <button
          type="button"
          onClick={handleSaveAsTemplate}
          disabled={!templateNameInput.trim() || templateSaving}
          className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {templateSaving ? 'Saving…' : 'Save as template'}
        </button>
        {templateError && <span className="text-xs font-semibold text-status-bad">{templateError}</span>}
      </div>
    </section>
  )
}
