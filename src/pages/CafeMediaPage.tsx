import { useEffect, useState } from 'react'
import MediaPanel from '../components/media/MediaPanel'
import CafeTicker, { type TickerSlot, type TickerSlotType } from '../components/CafeTicker'
import VenueCornerBadge from '../components/VenueCornerBadge'
import { currentMedia } from '../config/media'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { useVisibilityForecast } from '../services/visibilityForecastService'

const CAFE_SETTINGS_URL = '/api/tenant/cafe-settings'
const TICKER_SLOT_COUNT = 10

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
  return Array.from({ length: TICKER_SLOT_COUNT }, (_, i) => ({ position: i + 1, type: null }))
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
  safetyNotices: SafetyNotice[]
}

// Mirrors CafeTemplate.tsx's own JSX exactly (same grid/gap/zone
// structure) but driven by this page's locally-edited, not-yet-saved
// state instead of a fresh fetch - so what's shown here is what saving
// would actually produce, per your live-preview requirement.
function PreviewContent({
  airfieldName,
  logoUrl,
  layoutMode,
  adLabelEnabled,
  tickerEnabled,
  tickerSlots,
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
              <div className="relative flex h-full items-center justify-center overflow-hidden">
                <MediaPanel item={currentMedia} zone="left" />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className="relative flex h-full items-center justify-center overflow-hidden">
                <MediaPanel item={currentMedia} zone="right" />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className="relative flex h-full items-center justify-center overflow-hidden">
              <MediaPanel item={currentMedia} />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {tickerEnabled && (
          <div className="h-16 flex-shrink-0">
            <CafeTicker
              slots={tickerSlots}
              weather={weather}
              liveDataUnavailable={liveDataUnavailable}
              visibilityHours={visibilityHours}
              safetyNotices={safetyNotices}
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loadError, setLoadError] = useState(false)

  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])

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
          setTickerSlots(data.tickerSlots)
        }
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

  function updateSlotType(position: number, type: TickerSlotType | '') {
    setTickerSlots((prev) => prev.map((slot) => (slot.position === position ? { ...slot, type: type === '' ? null : type } : slot)))
  }

  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch(CAFE_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutMode, adLabelEnabled, tickerEnabled, tickerSlots }),
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
          type - notices come from ATC Control's existing safety notices, so edit their text there.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tickerSlots.map((slot) => (
            <label key={slot.position} className="flex items-center gap-3">
              <span className="w-6 shrink-0 text-xs font-bold text-muted-500">{slot.position}.</span>
              <select
                value={slot.type ?? ''}
                onChange={(event) => updateSlotType(slot.position, event.target.value as TickerSlotType | '')}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {SLOT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
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
