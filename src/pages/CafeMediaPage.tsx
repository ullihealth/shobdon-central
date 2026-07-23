import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MediaPanel from '../components/media/MediaPanel'
import CafeTicker, { type TickerSlot, type TickerSlotType, type TickerStyle } from '../components/CafeTicker'
import VenueCornerBadge from '../components/VenueCornerBadge'
import { CarouselSlotEditor, CarouselSlotList, filterAssetsForScreen, type CameraOption } from '../components/media/CarouselSlotEditor'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'
import { currentMedia } from '../config/media'
import { CAFE_CAROUSEL_SLOTS_URL, MEDIA_LIBRARY_URL, OPS_PANEL_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
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
const NOTICE_NAME_MAX_LENGTH = 40
const NOTICE_TEXT_MAX_LENGTH = 40

// id/name added for Part C - notices are now named and individually
// selectable per ticker slot, not one undifferentiated block of text.
// Same shape as ops-panel/index.ts's own SafetyNoticeStored and
// AtcControlPage.tsx's own local copy - this IS that same data, read
// and written through the exact same /api/tenant/ops-panel endpoint,
// not a parallel store.
interface SafetyNotice {
  id: string
  name: string
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

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

// Base types plus one option per EXISTING notice - replaces the old
// static single "Notice (from ATC Control)" entry, per Part C: each
// slot now picks a specific named notice, so different slots can show
// different notices independently. All notices are listed regardless
// of their own enabled state (a slot can be pre-wired to a currently-
// off notice, ready for later) - the "(off)" suffix makes that visible
// rather than silently confusing.
function buildSlotOptions(notices: SafetyNotice[]): { value: string; label: string }[] {
  return [
    { value: '', label: '— None —' },
    { value: 'clock', label: 'Clock / Date' },
    { value: 'forecast', label: '6-Hour Met Office Forecast' },
    { value: 'conditions', label: 'Current Conditions (Temp / Wind)' },
    ...notices.map((notice) => ({
      value: `notice:${notice.id}`,
      label: `Notice: ${notice.name || notice.text}${notice.enabled === false ? ' (off)' : ''}`,
    })),
  ]
}

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
// PREVIEW_DISPLAY_WIDTH matches DesignPage.tsx's own preview size (800,
// down from 1000 - a 20% reduction applied there first) so both admin
// pages present their preview at a consistent size - same derivation,
// width is the only knob, height and scale follow automatically so the
// aspect ratio (and therefore everything rendered inside) stays exact.
const PREVIEW_REFERENCE_WIDTH = 1920
const PREVIEW_REFERENCE_HEIGHT = 1080
const PREVIEW_DISPLAY_WIDTH = 800
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
  // Bumped whenever a Carousel Slots save actually lands server-side -
  // see MediaPanel.tsx's own comment on refreshSignal. Corrects a real
  // bug: MediaPanel self-fetches its media from /api/public/config
  // rather than reading this page's own local `cafeSlots` state, so
  // WITHOUT this it fetches once on mount and then never again -
  // editing a slot's Zone (or Source, or anything else) below had zero
  // visible effect on this preview until a full page reload, even
  // though the save itself was working correctly.
  cafeSlotsRefreshSignal: number
}

// Mirrors CafeTemplate.tsx's own JSX exactly (same grid/gap/zone
// structure). Ticker/layout/ad-label props below ARE driven by this
// page's locally-edited, not-yet-saved state, so those reflect
// immediately, no fetch involved. The carousel media itself is NOT -
// MediaPanel self-fetches independently from /api/public/config (same
// as the real public dashboard does) - so it only reflects whatever was
// last actually SAVED, and only once cafeSlotsRefreshSignal tells it to
// re-check (see that prop's own comment). This is a deliberate
// distinction worth knowing, not an oversight: unlike ticker/layout
// settings, media-panel content depends on `files` (the media library)
// as well as `cafeSlots`, joined server-side in publicConfig.ts - a
// second, meaningfully different data shape from what this page already
// has as local state.
function PreviewContent({
  airfieldName,
  logoUrl,
  layoutMode,
  adLabelEnabled,
  tickerEnabled,
  tickerSlots,
  tickerStyle,
  safetyNotices,
  cafeSlotsRefreshSignal,
}: PreviewContentProps): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()

  return (
    <div className="h-full w-full bg-gradient-to-b from-page-from via-page-via to-page-to p-10 text-slate-100">
      <div style={{ display: 'grid', gridTemplateRows: tickerEnabled ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
        {/* min-w-0: see the ticker wrapper's own comment below - same
            grid-item min-width:auto blowout risk applies here too. */}
        <div className="relative min-h-0 min-w-0">
          <div className="absolute left-0 top-0 z-10">
            <VenueCornerBadge airfieldName={airfieldName} logoUrl={logoUrl} />
          </div>

          {layoutMode === 'split' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="left" fill slotSource="cafe" refreshSignal={cafeSlotsRefreshSignal} />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="right" fill slotSource="cafe" refreshSignal={cafeSlotsRefreshSignal} />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className="relative h-full overflow-hidden">
              <MediaPanel item={currentMedia} fill slotSource="cafe" refreshSignal={cafeSlotsRefreshSignal} />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {/* overflow-hidden + min-w-0: this wrapper, not CafeTicker's own
            inner box, is the actual grid item in the single-column grid
            above - grid items default to min-width:auto (content-based),
            so without this the ticker's deliberately-wider-than-viewport
            marquee track (duplicated content for a seamless loop) wins
            the grid track's width calculation and inflates every row in
            this grid, including the media panel's. Same fix as
            CafeTemplate.tsx's own ticker wrapper (see that file's
            comment for the full mechanism and how it was confirmed live)
            - this file wasn't touched in that round since it's a
            separate, hand-maintained mirror of that JSX for the preview,
            not the same component reused. Here it read as the media
            panel going completely blank rather than "cut off on the
            right", because this preview additionally sits inside a
            fixed-size clipped/scaled-down box - the blown-out grid made
            MediaPanel's own `fill` box roughly double width, and its
            image (object-contain, centered by default) re-centered
            around that wider box's midpoint, landing outside or at the
            extreme edge of the small clipped preview viewport. */}
        {tickerEnabled && (
          <div className="min-w-0 overflow-hidden">
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
  // Preview-only mirror of the public dashboard's own opsPanel.safetyNotices
  // (fetched from PUBLIC_CONFIG_URL below, same as CafeTemplate.tsx itself
  // reads at render time) - kept in sync with `notices` after any CRUD
  // action below so the preview never lags what was just saved.
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])

  // Part C: the tenant's own manageable notices - loaded from
  // /api/tenant/ops-panel, the SAME endpoint (and SAME underlying
  // ops_panel_state row) ATC Control's Safety Notices section already
  // reads/writes. Not a second data source.
  const [notices, setNotices] = useState<SafetyNotice[]>([])
  const [noticeStatus, setNoticeStatus] = useState<SaveStatus>('idle')
  const [newNoticeName, setNewNoticeName] = useState('')
  const [newNoticeText, setNewNoticeText] = useState('')

  // Custom "Save as template" presets - personal/browser-local, same
  // storage convention as Screens Design's colour theme templates
  // (src/services/designTemplateStore.ts), not server-synced.
  const [customTemplates, setCustomTemplates] = useState<TickerStyleTemplate[]>(() => loadTickerStyleTemplates())
  const [templateNameInput, setTemplateNameInput] = useState('')

  // Collapsed by default - styling (colour/font/speed/gap) is a "set
  // once via a preset, rarely revisit" section, unlike the slot content
  // editor directly below it, which is what most visits to this page
  // are actually here to change. Collapsing it by default keeps that
  // more frequently-used section right under the preview without an
  // extra scroll, matching this reorg's own "reduce vertical space"
  // goal - expand on demand costs one click, whereas a permanently
  // expanded styling block would cost every visitor unwanted scrolling
  // on every visit.
  const [styleExpanded, setStyleExpanded] = useState(false)

  // Café's own, genuinely separate 12-slot carousel (migration 0037,
  // cafe_carousel_slots) - same shared CarouselSlotList/CarouselSlotEditor
  // components Dashboard Manager uses, pointed at a different API and a
  // different (café/both-tagged) slice of the media library. `files` is
  // the FULL, unfiltered library list (needed for CarouselSlotList's own
  // label lookups); the editor's own Source dropdown filters it further
  // via filterAssetsForScreen below.
  const [files, setFiles] = useState<MediaLibraryFile[]>([])
  const [cafeSlots, setCafeSlots] = useState<CarouselSlot[]>([])
  const [cameraOptions, setCameraOptions] = useState<CameraOption[]>([])
  const [selectedCafeSlotNumber, setSelectedCafeSlotNumber] = useState<number>(1)
  const [cafeAppearanceEditorOpen, setCafeAppearanceEditorOpen] = useState(false)
  const pendingCafeSavesRef = useRef<Map<number, CarouselSlot>>(new Map())
  const cafeSaveTimerRef = useRef<number | undefined>(undefined)
  // Bumped once a debounced Carousel Slots save actually completes -
  // see PreviewContentProps' own comment on why this is needed at all
  // (MediaPanel self-fetches, so without this the preview below never
  // learns a save happened).
  const [cafeSlotsRefreshSignal, setCafeSlotsRefreshSignal] = useState(0)

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
    // the real public dashboard reads them from. Also the source of
    // cameraOptions for the Carousel Slots section below (same
    // "already-public, safe to reuse for both owner and media-role
    // reads" reasoning MediaManagerPage.tsx's own loadCameraOptions
    // uses) - piggybacked on this existing fetch rather than a second
    // request for the same data.
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (data.airfieldName) setAirfieldName(data.airfieldName as string)
        if (data.logoUrl) setLogoUrl(data.logoUrl as string)
        if (data.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
        setCameraOptions((data.cameraSlots ?? []).filter((c: CameraOption) => c.url))
      })
      .catch(() => {})

    // Owner/admin-authenticated GET, same endpoint ATC Control uses -
    // this is what actually drives the Notices CRUD section and the
    // per-slot dropdown's list of selectable notices below (distinct
    // from the public, unauthenticated fetch above, which only feeds
    // the preview).
    fetch(OPS_PANEL_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.safetyNotices)) setNotices(data.safetyNotices)
      })
      .catch(() => {})

    // Café's own media library view (full, unfiltered list - see
    // filterAssetsForScreen's own comment for why the editor filters a
    // separate copy rather than this state itself) and its own,
    // separate 12-slot carousel (migration 0037).
    fetch(MEDIA_LIBRARY_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setFiles(data.files ?? [])
      })
      .catch(() => {})

    fetch(CAFE_CAROUSEL_SLOTS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setCafeSlots(data.slots ?? [])
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  function updateSlot(position: number, patch: Partial<TickerSlot>) {
    setTickerSlots((prev) => prev.map((slot) => (slot.position === position ? { ...slot, ...patch } : slot)))
  }

  // Fetches the CURRENT full ops-panel row immediately before writing,
  // rather than reusing whatever this page loaded at mount time. That
  // endpoint requires the FULL row on every PUT (activeRunwayEnd,
  // circuitDirection, etc. all required - no partial-field merge
  // server-side, unlike cafe-settings' own PUT) and is the SAME row ATC
  // Control's own bulk-edit-then-"Update Dashboard" flow writes to.
  // Re-fetching right here keeps every OTHER field exactly as it
  // currently is and shrinks the window in which a concurrent ATC
  // Control edit could be clobbered down to "between this fetch and
  // this PUT" - a real mitigation, not a complete fix. If ATC Control's
  // own Update Dashboard click lands inside that same short window, its
  // full-array overwrite still wins - the same pre-existing "last
  // write wins" behaviour this endpoint already has for two ATC
  // Control tabs open at once, now with a second page in the mix too.
  // True optimistic-concurrency-control (versioning/ETags) would close
  // this properly but is a bigger change than this pass - flagged, not
  // silently built around.
  async function withFreshOpsPanel(nextNotices: SafetyNotice[]): Promise<boolean> {
    const currentResponse = await fetch(OPS_PANEL_URL)
    if (!currentResponse.ok) return false
    const current = await currentResponse.json().catch(() => null)
    if (!current) return false
    const response = await fetch(OPS_PANEL_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, safetyNotices: nextNotices }),
    })
    return response.ok
  }

  function updateNoticeField(id: string, patch: Partial<SafetyNotice>) {
    setNotices((prev) => prev.map((notice) => (notice.id === id ? { ...notice, ...patch } : notice)))
  }

  // Batches any pending edits to EXISTING notices' name/text/size/enabled
  // into one save - typing in a name/text field only updates local
  // state (same "stage locally, explicit save" pattern ATC Control's
  // own form already uses), so this doesn't fire a network request per
  // keystroke.
  async function handleSaveNotices() {
    setNoticeStatus('working')
    const ok = await withFreshOpsPanel(notices)
    setNoticeStatus(ok ? 'success' : 'error')
    if (ok) setSafetyNotices(notices)
  }

  // Add/delete are immediate (not batched behind Save Notices) - a
  // newly-added notice needs to actually exist server-side right away
  // to be genuinely selectable in a ticker slot's dropdown, and a
  // delete is a deliberate one-shot action, not something staged
  // alongside in-progress text edits to OTHER rows.
  async function handleAddNotice() {
    const name = newNoticeName.trim()
    const text = newNoticeText.trim()
    if (!name || !text) return
    setNoticeStatus('working')
    const next: SafetyNotice = { id: crypto.randomUUID(), name, text, size: 'md', enabled: true }
    const merged = [...notices, next]
    const ok = await withFreshOpsPanel(merged)
    if (!ok) {
      setNoticeStatus('error')
      return
    }
    setNotices(merged)
    setSafetyNotices(merged)
    setNewNoticeName('')
    setNewNoticeText('')
    setNoticeStatus('success')
  }

  async function handleDeleteNotice(id: string) {
    if (!window.confirm('Delete this notice? Any ticker slot currently showing it will go blank until reassigned.')) return
    setNoticeStatus('working')
    const merged = notices.filter((notice) => notice.id !== id)
    const ok = await withFreshOpsPanel(merged)
    if (!ok) {
      setNoticeStatus('error')
      return
    }
    setNotices(merged)
    setSafetyNotices(merged)
    setNoticeStatus('success')
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

  // Same debounced-batch-write pattern as MediaManagerPage.tsx's own
  // saveSlot - local state (and so the Carousel Slots editor's own
  // inline appearance preview, via SlotAppearanceEditor/MediaSlotRenderer)
  // updates synchronously on every call; the network PUT is batched and
  // debounced so dragging a crop/rotation/brightness slider doesn't fire
  // a request per pixel. Independent of handleSave above - carousel
  // slots have always saved themselves immediately on this pattern,
  // never gated behind "Save Settings" (which only covers layout/ad
  // label/ticker), matching Dashboard Manager's own slots-save-
  // immediately behaviour exactly.
  //
  // The BIG preview above (PreviewContent) is a separate matter - it
  // doesn't read this local state at all, MediaPanel self-fetches
  // instead (see PreviewContentProps' own comment) - so once the PUT
  // actually resolves, cafeSlotsRefreshSignal is bumped to tell it to
  // re-check. This was the actual bug behind "the Zone dropdown has no
  // effect on the preview": the save always worked, the preview just
  // never knew to look again.
  function saveCafeSlot(updated: CarouselSlot) {
    setCafeSlots((prev) => prev.map((s) => (s.slotNumber === updated.slotNumber ? updated : s)))
    pendingCafeSavesRef.current.set(updated.slotNumber, updated)
    window.clearTimeout(cafeSaveTimerRef.current)
    cafeSaveTimerRef.current = window.setTimeout(() => {
      const toSave = Array.from(pendingCafeSavesRef.current.values())
      pendingCafeSavesRef.current.clear()
      if (toSave.length === 0) return
      fetch(CAFE_CAROUSEL_SLOTS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: toSave }),
      }).then(() => setCafeSlotsRefreshSignal((n) => n + 1))
    }, 300)
  }

  function handleCafeSourceChange(slot: CarouselSlot, value: string) {
    if (value.startsWith('webcam:')) {
      const cameraSlotNumber = Number(value.slice('webcam:'.length))
      saveCafeSlot({ ...slot, mediaType: 'webcam', cameraSlotNumber, mediaLibraryId: null })
      return
    }
    if (value.startsWith('file:')) {
      const fileId = value.slice('file:'.length)
      const file = files.find((f) => f.id === fileId)
      if (!file) return
      saveCafeSlot({ ...slot, mediaType: file.mediaType, mediaLibraryId: fileId, cameraSlotNumber: null })
      return
    }
    saveCafeSlot({ ...slot, mediaType: 'image', mediaLibraryId: null, cameraSlotNumber: null })
  }

  // Deliberately does NOT touch cafeAppearanceEditorOpen - it used to
  // force-close it on every selection, which unmounted the appearance
  // editor (and its preview <img>) the instant you picked a different
  // slot while it was already open, until you manually reopened it. The
  // editor's own open/closed state and which slot is selected are
  // independent: leaving it alone means an already-open editor simply
  // keeps showing whatever slot is now selected, immediately - it was
  // never the preview itself going stale (resolveSlotVisual/
  // MediaSlotRenderer already recompute correctly on every render).
  function selectCafeSlot(slotNumber: number) {
    setSelectedCafeSlotNumber(slotNumber)
  }

  const selectedCafeSlot = cafeSlots.find((s) => s.slotNumber === selectedCafeSlotNumber) ?? null

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
              cafeSlotsRefreshSignal={cafeSlotsRefreshSignal}
            />
          </WeatherProvider>
        </div>
      </div>

      {/* CAROUSEL SLOTS - café's own, separate 12-slot carousel
          (migration 0037), mirroring Dashboard Manager's slot UI exactly
          via the same shared CarouselSlotList/CarouselSlotEditor
          components - just pointed at cafe_carousel_slots through
          CAFE_CAROUSEL_SLOTS_URL instead of the dashboard's table, and
          filtered to café/both-tagged media (further narrowed to
          9:16/both-orientation assets when the selected slot's own zone
          is left/right - split-pane's two side-by-side panels favour
          portrait-shaped assets; a 'both'-zoned slot stays unfiltered by
          orientation since it can render in full-16:9 OR either split
          zone depending on the Layout setting below). Placed right under
          the preview, before Ticker Style, matching Dashboard Manager's
          own "slots are the daily-use control" ordering. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Carousel Slots</div>
          <Link to="/media-library" className="text-xs font-semibold text-accent-sky-400 hover:underline">
            Manage Media Library →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <CarouselSlotList
            slots={cafeSlots}
            files={files}
            cameraOptions={cameraOptions}
            selectedSlotNumber={selectedCafeSlotNumber}
            onSelect={selectCafeSlot}
            onToggleEnabled={(slot, enabled) => saveCafeSlot({ ...slot, enabled })}
          />
          {selectedCafeSlot && (
            <CarouselSlotEditor
              slot={selectedCafeSlot}
              files={filterAssetsForScreen(files, 'cafe', selectedCafeSlot.zone)}
              cameraOptions={cameraOptions}
              appearanceOpen={cafeAppearanceEditorOpen}
              onToggleAppearance={() => setCafeAppearanceEditorOpen((prev) => !prev)}
              onSourceChange={(value) => handleCafeSourceChange(selectedCafeSlot, value)}
              onChange={(patch) => saveCafeSlot({ ...selectedCafeSlot, ...patch })}
            />
          )}
        </div>
      </section>

      {/* TICKER STYLE - moved directly beneath the preview (was below
          Footer Ticker) and made a collapsible accordion: the header
          itself is the toggle button, controlling styleExpanded. See
          that state's own comment for why it defaults collapsed. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
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
                  At the high end, one message fully scrolls off-screen before the next appears - that blank moment
                  is expected, not a bug.
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
          </div>
        )}
      </section>

      {/* NOTICES - Part C: named, tenant-manageable notices, full CRUD
          here - same single ops_panel_state row ATC Control's Safety
          Notices section reads/writes, not a parallel store. Placed
          directly above Footer Ticker so a notice exists to pick before
          reaching the slot dropdowns that reference it. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Notices</div>
        <p className="mb-4 text-xs text-muted-500">
          Create named notices here to show in specific ticker slots below. Same notices ATC Control's Safety
          Notices section manages - editing or deleting one here updates it there too, and vice versa.
        </p>

        <div className="mb-4 flex flex-col gap-1.5">
          {notices.map((notice) => (
            <div key={notice.id} className={`flex items-center gap-2 ${notice.enabled === false ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={notice.enabled !== false}
                onChange={(event) => updateNoticeField(notice.id, { enabled: event.target.checked })}
                className="h-3.5 w-3.5 flex-shrink-0"
                title="Enabled"
              />
              <input
                type="text"
                value={notice.name}
                onChange={(event) => updateNoticeField(notice.id, { name: event.target.value.slice(0, NOTICE_NAME_MAX_LENGTH) })}
                maxLength={NOTICE_NAME_MAX_LENGTH}
                placeholder="Name"
                className="w-40 flex-shrink-0 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
              <input
                type="text"
                value={notice.text}
                onChange={(event) => updateNoticeField(notice.id, { text: event.target.value.slice(0, NOTICE_TEXT_MAX_LENGTH) })}
                maxLength={NOTICE_TEXT_MAX_LENGTH}
                placeholder="Notice text"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleDeleteNotice(notice.id)}
                className="shrink-0 text-xs font-semibold text-muted-500 hover:text-status-bad"
              >
                Delete
              </button>
            </div>
          ))}
          {notices.length === 0 && <p className="text-xs text-muted-500">No notices yet - add one below.</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <input
            value={newNoticeName}
            onChange={(event) => setNewNoticeName(event.target.value.slice(0, NOTICE_NAME_MAX_LENGTH))}
            placeholder="New notice name"
            className="w-40 rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
          />
          <input
            value={newNoticeText}
            onChange={(event) => setNewNoticeText(event.target.value.slice(0, NOTICE_TEXT_MAX_LENGTH))}
            placeholder="Notice text"
            className="min-w-0 flex-1 rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
          />
          <button
            type="button"
            onClick={handleAddNotice}
            disabled={!newNoticeName.trim() || !newNoticeText.trim() || noticeStatus === 'working'}
            className="shrink-0 rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Notice
          </button>
          <button
            type="button"
            onClick={handleSaveNotices}
            disabled={noticeStatus === 'working'}
            className="shrink-0 rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {noticeStatus === 'working' ? 'Saving…' : 'Save Notice Edits'}
          </button>
          {noticeStatus === 'success' && <span className="text-sm font-semibold text-status-good">Saved.</span>}
          {noticeStatus === 'error' && <span className="text-sm font-semibold text-status-bad">Couldn't save - please try again.</span>}
        </div>
      </section>

      {/* FOOTER TICKER - directly beneath Ticker Style, per your
          requested order: collapsed styling -> this sits right under
          the preview; expanded styling -> this sits below the
          expanded controls. */}
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
          type and independently switched on/off - pick a specific named notice from the Notices section above,
          different slots can show different notices. A slot's own toggle only matters while the master toggle
          above is on.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tickerSlots.map((slot) => (
            <div key={slot.position} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs font-bold text-muted-500">{slot.position}.</span>
              <select
                value={slotOptionValue(slot)}
                onChange={(event) => updateSlot(slot.position, parseSlotOptionValue(event.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {buildSlotOptions(notices).map((option) => (
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

      {/* LAYOUT + AD LABEL + SAVE - condensed onto one row (was three
          separate full-width sections) to cut vertical space. Same
          state/handlers as before, just laid out differently -
          wraps on narrow screens via flex-wrap. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-3" title="Split-pane shows two independent carousel zones side by side (assign slots to Left/Right in Dashboard Manager). Full 16:9 shows a single carousel filling the whole area.">
            <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-accent-sky-400">Layout</span>
            <div className="flex gap-2">
              {(['full', 'split'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLayoutMode(mode)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                    layoutMode === mode
                      ? 'border-accent-sky-500 bg-slate-900 text-white'
                      : 'border-border bg-slate-900/80 text-slate-300 hover:border-accent-sky-500/60'
                  }`}
                >
                  {mode === 'full' ? 'Full 16:9' : 'Split-Pane'}
                </button>
              ))}
            </div>
          </div>

          <label
            className="flex cursor-pointer items-center gap-3"
            title='When on, a small "Advertisement" label appears on carousel content.'
          >
            <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-accent-sky-400">Ad Label</span>
            <input
              type="checkbox"
              checked={adLabelEnabled}
              onChange={(event) => setAdLabelEnabled(event.target.checked)}
              className="h-5 w-5 accent-accent-sky-500"
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus === 'working'}
              className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveStatus === 'working' ? 'Saving…' : 'Save Settings'}
            </button>
            {saveStatus === 'success' && <span className="text-sm font-semibold text-status-good">Saved.</span>}
            {saveStatus === 'error' && <span className="text-sm font-semibold text-status-bad">Couldn't save.</span>}
          </div>
        </div>
      </section>

      {/* AD SLOTS - PLACEHOLDER */}
      <section className="mb-8 rounded-2xl border border-dashed border-border bg-panel/50 p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-muted-500">Ad Slots</div>
        <p className="text-xs text-muted-500">Coming soon - manage paid advertisement content for this template here.</p>
      </section>
    </div>
  )
}
