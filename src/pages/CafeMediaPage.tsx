import { useEffect, useState } from 'react'
import MediaPanel from '../components/media/MediaPanel'
import CafeTicker, { type TickerSlot, type TickerSlotType, type TickerStyle } from '../components/CafeTicker'
import VenueCornerBadge from '../components/VenueCornerBadge'
import { currentMedia } from '../config/media'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { useVisibilityForecast } from '../services/visibilityForecastService'
import {
  BUILT_IN_TICKER_PRESETS,
  DEFAULT_TICKER_STYLE,
  loadTickerStyleTemplates,
  saveTickerStyleTemplates,
  type TickerStyleTemplate,
} from '../services/tickerStyleStore'

const CAFE_SETTINGS_URL = '/api/tenant/cafe-settings'
const TICKER_SLOT_COUNT = 10
const FONT_FAMILY_OPTIONS: TickerStyle['fontFamily'][] = ['Inter', 'Montserrat', 'Oswald']

interface SafetyNotice {
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

const SLOT_TYPE_OPTIONS: { value: TickerSlotType | ''; label: string }[] = [
  { value: '', label: '— None —' },
  { value: 'clock', label: 'Clock / Date' },
  { value: 'forecast', label: '6-Hour Met Office Forecast' },
  { value: 'conditions', label: 'Current Conditions (Temp / Wind)' },
  { value: 'notice', label: 'Notice (from ATC Control)' },
]

function defaultTickerSlots(): TickerSlot[] {
  return Array.from({ length: TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null, enabled: true }))
}

// Same ticker* wire-format field names cafe-settings/index.ts and
// publicConfig.ts both use - see CafeTemplate.tsx's own
// tickerStyleFromApi() for why this mapping exists at all (CafeTicker's
// own TickerStyle prop is deliberately unprefixed).
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

// Live preview at the real 1920x1080 reference size, scaled down as one
// unit via transform - same "render the real components, don't mock the
// layout" convention DesignPage.tsx already established for its own
// preview. Uses WeatherProvider with no forcedConfig (unlike DesignPage's
// preview), so this shows this tenant's real live weather, matching your
// instruction that the preview reflect actual data, not placeholders.
const PREVIEW_REFERENCE_WIDTH = 1920
const PREVIEW_REFERENCE_HEIGHT = 1080
const PREVIEW_DISPLAY_WIDTH = 1000
const PREVIEW_SCALE = PREVIEW_DISPLAY_WIDTH / PREVIEW_REFERENCE_WIDTH
const PREVIEW_DISPLAY_HEIGHT = PREVIEW_REFERENCE_HEIGHT * PREVIEW_SCALE

function AdLabel(): JSX.Element {
  return (
    <div className="absolute right-2 top-2 z-10 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
      Advertisement
    </div>
  )
}

interface PreviewContentProps {
  airfieldName: string | null
  logoUrl: string | null
  layoutMode: 'split' | 'full'
  adLabelEnabled: boolean
  tickerEnabled: boolean
  tickerSlots: TickerSlot[]
  tickerStyle: TickerStyle
  safetyNotices: SafetyNotice[]
}

// Mirrors CafeTemplate.tsx's own JSX exactly (same grid/gap/zone
// structure) but driven by this page's locally-edited, not-yet-saved
// state instead of a fresh fetch - so what's shown here is what saving
// would actually produce, per your live-preview requirement. Every
// style control (Part A) and per-slot toggle (Part B) below feeds
// straight into this same tree via ordinary React state, so a change
// reflects immediately, exactly like the existing slot/layout controls.
function PreviewContent({
  airfieldName,
  logoUrl,
  layoutMode,
  adLabelEnabled,
  tickerEnabled,
  tickerSlots,
  tickerStyle,
  safetyNotices,
}: PreviewContentProps): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  return (
    <div className="h-full w-full bg-gradient-to-b from-page-from via-page-via to-page-to p-10 text-slate-100">
      <div style={{ display: 'grid', gridTemplateRows: tickerEnabled ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
        <div className="relative min-h-0">
          <div className="absolute left-0 top-0 z-10">
            <VenueCornerBadge airfieldName={airfieldName} logoUrl={logoUrl} />
          </div>

          {layoutMode === 'split' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="left" fill />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="right" fill />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className="relative h-full overflow-hidden">
              <MediaPanel item={currentMedia} fill />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {tickerEnabled && (
          <div className="flex-shrink-0">
            <CafeTicker
              slots={tickerSlots}
              weather={weather}
              liveDataUnavailable={liveDataUnavailable}
              visibilityHours={visibilityHours}
              safetyNotices={safetyNotices}
              style={tickerStyle}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function CafeMediaPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [layoutMode, setLayoutMode] = useState<'split' | 'full'>('full')
  const [adLabelEnabled, setAdLabelEnabled] = useState(false)
  const [tickerEnabled, setTickerEnabled] = useState(false)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>(defaultTickerSlots())
  const [tickerStyle, setTickerStyle] = useState<TickerStyle>(DEFAULT_TICKER_STYLE)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loadError, setLoadError] = useState(false)

  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])

  // Custom "Save as template" presets - personal/browser-local, same
  // storage convention as Dashboard Design's colour theme templates
  // (src/services/designTemplateStore.ts), not server-synced.
  const [customTemplates, setCustomTemplates] = useState<TickerStyleTemplate[]>(() => loadTickerStyleTemplates())
  const [templateNameInput, setTemplateNameInput] = useState('')

  useEffect(() => {
    let cancelled = false

    fetch(CAFE_SETTINGS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setLoadError(true)
          return
        }
        setLayoutMode(data.layoutMode === 'split' ? 'split' : 'full')
        setAdLabelEnabled(!!data.adLabelEnabled)
        setTickerEnabled(!!data.tickerEnabled)
        if (Array.isArray(data.tickerSlots) && data.tickerSlots.length === TICKER_SLOT_COUNT) {
          setTickerSlots(data.tickerSlots.map((slot: TickerSlot) => ({ ...slot, enabled: slot.enabled !== false })))
        }
        setTickerStyle(tickerStyleFromApi(data))
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    // Same PUBLIC_CONFIG_URL fetch CafeTemplate.tsx itself uses - keeps
    // this preview's branding/notices sourced from the exact same place
    // the real public dashboard reads them from.
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (data.airfieldName) setAirfieldName(data.airfieldName as string)
        if (data.logoUrl) setLogoUrl(data.logoUrl as string)
        if (data.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
      })
      .catch(() => {})

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
    // Presets are a starting point, not a locked-in choice - applying
    // one just seeds every control's current value; each stays fully
    // adjustable afterwards via the controls below, per your instruction.
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

  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch(CAFE_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layoutMode,
          adLabelEnabled,
          tickerEnabled,
          tickerSlots,
          ...tickerStyleToApi(tickerStyle),
        }),
      })
      if (!response.ok) {
        setSaveStatus('error')
        return
      }
      setSaveStatus('success')
    } catch {
      setSaveStatus('error')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-muted-400">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Cafe Media</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Settings for the Café dashboard template - split/full layout, the advertisement label, and the footer
        ticker. The preview below updates as you configure things, using this tenant's real live weather and
        notices - nothing is saved until you click "Save Settings".
      </p>
      {loadError && (
        <p className="mb-6 text-sm font-semibold text-status-bad">Couldn't load current settings - showing defaults.</p>
      )}

      {/* LIVE PREVIEW */}
      <div
        className="mb-8 overflow-hidden rounded-2xl border border-border"
        style={{ width: PREVIEW_DISPLAY_WIDTH, height: PREVIEW_DISPLAY_HEIGHT }}
      >
        <div
          style={{
            width: PREVIEW_REFERENCE_WIDTH,
            height: PREVIEW_REFERENCE_HEIGHT,
            transform: `scale(${PREVIEW_SCALE})`,
            transformOrigin: 'top left',
          }}
        >
          <WeatherProvider>
            <PreviewContent
              airfieldName={airfieldName}
              logoUrl={logoUrl}
              layoutMode={layoutMode}
              adLabelEnabled={adLabelEnabled}
              tickerEnabled={tickerEnabled}
              tickerSlots={tickerSlots}
              tickerStyle={tickerStyle}
              safetyNotices={safetyNotices}
            />
          </WeatherProvider>
        </div>
      </div>

      {/* LAYOUT MODE */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Layout</div>
        <p className="mb-4 text-xs text-muted-500">
          Split-pane shows two independent carousel zones side by side (assign slots to Left/Right in Media
          Manager). Full 16:9 shows a single carousel filling the whole area.
        </p>
        <div className="flex gap-3">
          {(['full', 'split'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayoutMode(mode)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                layoutMode === mode
                  ? 'border-accent-sky-500 bg-slate-900 text-white'
                  : 'border-border bg-slate-900/80 text-slate-300 hover:border-accent-sky-500/60'
              }`}
            >
              {mode === 'full' ? 'Full 16:9' : 'Split-Pane'}
            </button>
          ))}
        </div>
      </section>

      {/* AD LABEL */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Advertisement Label</div>
        <p className="mb-4 text-xs text-muted-500">
          When on, a small "Advertisement" label appears on carousel content.
        </p>
        <label className="flex w-fit cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={adLabelEnabled}
            onChange={(event) => setAdLabelEnabled(event.target.checked)}
            className="h-5 w-5 accent-accent-sky-500"
          />
          <span className="text-sm font-semibold text-primary">{adLabelEnabled ? 'On' : 'Off'}</span>
        </label>
      </section>

      {/* TICKER */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
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
          type and independently switched on/off - notices come from ATC Control's existing safety notices, so
          edit their text there. A slot's own toggle only matters while the master toggle above is on.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tickerSlots.map((slot) => (
            <div key={slot.position} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs font-bold text-muted-500">{slot.position}.</span>
              <select
                value={slot.type ?? ''}
                onChange={(event) => updateSlot(slot.position, { type: (event.target.value || null) as TickerSlotType | null })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {SLOT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5" title="Enable this slot">
                <input
                  type="checkbox"
                  checked={slot.enabled !== false}
                  onChange={(event) => updateSlot(slot.position, { enabled: event.target.checked })}
                  className="h-4 w-4 accent-accent-sky-500"
                />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-500">On</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      {/* TICKER STYLE - Phase 2, deliberately deferred when the ticker
          first shipped. All controls write into the same tickerStyle
          state the preview above already reads, so every change is
          immediately visible there too. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Ticker Style</div>
        <p className="mb-4 text-xs text-muted-500">
          Background, text, and scroll-speed appearance for the footer ticker. Pick a preset below as a starting
          point, then fine-tune anything here.
        </p>

        {/* PRESETS */}
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

        {/* CONTROLS */}
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
              At the high end, one message fully scrolls off-screen before the next appears - that blank moment is
              expected, not a bug.
            </span>
          </label>
        </div>

        {/* SAVE AS TEMPLATE */}
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
      </section>

      {/* AD SLOTS - PLACEHOLDER */}
      <section className="mb-8 rounded-2xl border border-dashed border-border bg-panel/50 p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-muted-500">Ad Slots</div>
        <p className="text-xs text-muted-500">Coming soon - manage paid advertisement content for this template here.</p>
      </section>

      {/* SAVE */}
      <section className="mb-8 rounded-2xl border border-accent-sky-500/40 bg-panel p-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveStatus === 'working'}
          className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveStatus === 'working' ? 'Saving…' : 'Save Settings'}
        </button>
        {saveStatus === 'success' && <p className="mt-3 text-sm font-semibold text-status-good">Saved.</p>}
        {saveStatus === 'error' && <p className="mt-3 text-sm font-semibold text-status-bad">Couldn't save - please try again.</p>}
      </section>
    </div>
  )
}
