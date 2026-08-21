import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import MediaPanel, { type MediaPanelSourceData } from '../components/media/MediaPanel'
import CafeTicker, { type TickerGasPrices, type TickerSlot, type TickerStyle } from '../components/CafeTicker'
import VenueCornerBadge from '../components/VenueCornerBadge'
import FeatureUpsellPanel from '../components/FeatureUpsellPanel'
import { CarouselSlotEditor, CarouselSlotList, filterAssetsForScreen, type CameraOption } from '../components/media/CarouselSlotEditor'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'
import { currentMedia } from '../config/media'
import { CAFE_CAROUSEL_SLOTS_URL, MEDIA_LIBRARY_URL, OPS_PANEL_URL, TENANT_CONFIG_URL } from '../config/publicApi'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { useVisibilityForecast } from '../services/visibilityForecastService'
import { DEFAULT_TICKER_STYLE } from '../services/tickerStyleStore'
import { useElementHeight } from '../hooks/useElementHeight'

const CAFE_SETTINGS_URL = '/api/tenant/cafe-settings'
const TICKER_SLOT_COUNT = 10
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
  // Task #42 - preview-only mirror of this tenant's own gas_prices row,
  // same sourcing/pattern as safetyNotices above.
  gasPrices: TickerGasPrices
  // Bumped whenever a Carousel Slots save actually lands server-side -
  // see MediaPanel.tsx's own comment on refreshSignal. Corrects a real
  // bug: MediaPanel self-fetches its media from /api/public/config
  // rather than reading this page's own local `cafeSlots` state, so
  // WITHOUT this it fetches once on mount and then never again -
  // editing a slot's Zone (or Source, or anything else) below had zero
  // visible effect on this preview until a full page reload, even
  // though the save itself was working correctly.
  cafeSlotsRefreshSignal: number
  // Passed straight through to each MediaPanel call's own `data` prop -
  // see MediaPanel.tsx's own comment for the full story (this page's
  // own admin session may be switched to a different org than the
  // browser's current subdomain, which is what MediaPanel's self-fetch
  // otherwise resolves by - the exact cross-tenant leak this round
  // fixes).
  mediaData?: MediaPanelSourceData
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
  gasPrices,
  cafeSlotsRefreshSignal,
  mediaData,
}: PreviewContentProps): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()
  // See Clubhouse1Template.tsx's own comment - measures the ticker
  // overlay's real rendered height so the media area's grid row can
  // reserve exactly that much space, instead of rendering underneath it
  // (this preview is meant to accurately show what tenants see live).
  const [tickerRef, tickerHeight] = useElementHeight<HTMLDivElement>()

  return (
    // position: relative - the ticker overlay below (see its own
    // comment) breaks out past this box's own p-10 padding via a
    // matching negative offset, same mechanism FooterTicker.tsx/
    // CafeTemplate.tsx now use against their own clamp()-based padding -
    // this preview uses a fixed p-10 instead of that vmin-based formula
    // since vmin would resolve against the ADMIN PAGE's real browser
    // viewport here, not this scaled reference box (see the investigation
    // that first flagged this: CafeMediaPage.tsx's PreviewContent is a
    // hand-mirrored, not byte-identical, copy of CafeTemplate.tsx).
    <div className="relative h-full w-full bg-gradient-to-b from-page-from via-page-via to-page-to p-10 text-slate-100">
      <div style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%', paddingBottom: tickerHeight }}>
        {/* min-w-0: this div is a grid item in the single-row grid
            above; grid items default to min-width:auto (content-based),
            not 0. (The ticker below is no longer a grid item at all as
            of this round - see its own comment.) */}
        <div className="relative min-h-0 min-w-0">
          <div className="absolute left-2 top-2 z-10">
            <VenueCornerBadge airfieldName={airfieldName} logoUrl={logoUrl} />
          </div>

          {layoutMode === 'split' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="left" fill slotSource="cafe" refreshSignal={cafeSlotsRefreshSignal} data={mediaData} />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="right" fill slotSource="cafe" refreshSignal={cafeSlotsRefreshSignal} data={mediaData} />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className="relative h-full overflow-hidden">
              <MediaPanel item={currentMedia} fill slotSource="cafe" refreshSignal={cafeSlotsRefreshSignal} data={mediaData} />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

      </div>

      {/* FOOTER TICKER - matches CafeTemplate.tsx's own overlay treatment
          (see FooterTicker.tsx's own comment for the full positioning
          mechanism) rather than reserving a grid row, so this preview
          keeps accurately representing what tenants actually see live.
          inset-x-0 bottom-0, NOT a negative offset past those edges -
          the containing block's own padding edge already IS this
          component's own outer edge regardless of its `p-10` property
          (an earlier version used -2.5rem, p-10's own value negated, on
          the wrong assumption that 0 would land inset by the padding
          instead - confirmed wrong by direct measurement: it pushed the
          ticker's own bottom edge past this preview's outer clipping
          box, silently cropping roughly the bottom half of the bar).
          overflow-x-hidden (not min-w-0 - no longer a grid item, see
          CafeTemplate.tsx's own comment on why that half of the old fix
          is gone; not overflow-hidden either - see CafeTicker.tsx's own
          comment on why an oversized Font Size deliberately overflows
          vertically now rather than being clipped) still clips
          CafeTicker's deliberately wider-than-box marquee track
          horizontally. */}
      {tickerEnabled && (
        <div ref={tickerRef} className="absolute inset-x-0 bottom-0 z-10 overflow-x-hidden">
          <CafeTicker
            slots={tickerSlots}
            weather={weather}
            liveDataUnavailable={liveDataUnavailable}
            visibilityHours={visibilityHours}
            safetyNotices={safetyNotices}
            gasPrices={gasPrices}
            style={tickerStyle}
          />
        </div>
      )}
    </div>
  )
}

const DEFAULT_GAS_PRICES: TickerGasPrices = { avgasPrice: null, ul91Price: null, jetA1Price: null, currency: '£' }

export default function CafeMediaPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [layoutMode, setLayoutMode] = useState<'split' | 'full'>('full')
  const [adLabelEnabled, setAdLabelEnabled] = useState(false)
  const [tickerEnabled, setTickerEnabled] = useState(false)
  const [tickerSlots, setTickerSlots] = useState<TickerSlot[]>(defaultTickerSlots())
  const [tickerStyle, setTickerStyle] = useState<TickerStyle>(DEFAULT_TICKER_STYLE)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loadError, setLoadError] = useState(false)

  // Whether THIS tenant's cafe-tv display is currently entitled
  // (tenant_displays.entitled, migration 0034 - a paid feature, not a
  // generic "published" flag - see the café-display upsell
  // investigation). The default value here never actually gets
  // rendered against real content either way: this fetch is folded
  // into the same `loading` gate as everything else below (Promise.all),
  // so the page shows "Loading…" until entitlement is genuinely known,
  // rather than briefly flashing the editor OR the upsell panel first.
  // Read from /api/tenant/displays (functions/api/tenant/displays.ts),
  // the same owner-facing endpoint /config's "Your displays" list
  // already uses - not a new route.
  const [cafeTvEntitled, setCafeTvEntitled] = useState(true)

  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  // Preview-only mirror of this tenant's own opsPanel.safetyNotices
  // (fetched from TENANT_CONFIG_URL below, session-scoped) - kept in
  // sync with `notices` after any CRUD action below so the preview
  // never lags what was just saved.
  const [safetyNotices, setSafetyNotices] = useState<SafetyNotice[]>([])
  // Task #42 - preview mirror of gas_prices, same TENANT_CONFIG_URL
  // sourcing as safetyNotices above (see that fetch below for why
  // session-scoped, not Host-resolved).
  const [gasPrices, setGasPrices] = useState<TickerGasPrices>(DEFAULT_GAS_PRICES)
  // Passed to PreviewContent's MediaPanel calls via their `data` prop -
  // see that prop's own comment. Sourced from the TENANT_CONFIG_URL
  // fetch below (session-scoped), not PUBLIC_CONFIG_URL (Host-resolved) -
  // this page used to read airfieldName/logoUrl/safetyNotices/
  // cameraOptions from the Host-resolved endpoint too, which had the
  // exact same cross-tenant leak as MediaPanel's own self-fetch whenever
  // this admin's session was switched to a different org than the
  // current subdomain (including which cameras appear as selectable
  // webcam sources in the Carousel Slots editor below - a functional
  // bug, not just a cosmetic preview one).
  const [mediaData, setMediaData] = useState<MediaPanelSourceData | undefined>(undefined)

  // Part C: the tenant's own manageable notices - loaded from
  // /api/tenant/ops-panel, the SAME endpoint (and SAME underlying
  // ops_panel_state row) ATC Control's Safety Notices section already
  // reads/writes. Not a second data source.
  const [notices, setNotices] = useState<SafetyNotice[]>([])
  const [noticeStatus, setNoticeStatus] = useState<SaveStatus>('idle')
  const [newNoticeName, setNewNoticeName] = useState('')
  const [newNoticeText, setNewNoticeText] = useState('')

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

    const cafeSettingsLoaded = fetch(CAFE_SETTINGS_URL)
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

    // Folded into the same loading gate as cafeSettingsLoaded above
    // (Promise.all below) rather than resolving independently - so the
    // page never briefly shows the slot editor to a not-yet-entitled
    // tenant, or the FeatureUpsellPanel to an entitled one, before this
    // is actually known.
    const entitlementLoaded = fetch('/api/tenant/displays')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const cafeTv = (data.displays ?? []).find((d: { slug: string }) => d.slug === 'cafe-tv')
        // No cafe-tv row at all yet (never onboarded/visited) is treated
        // the same as not entitled - there's nothing to edit either way,
        // and showing the upsell is more honest than a blank editor for
        // a display that doesn't exist yet.
        setCafeTvEntitled(!!cafeTv?.entitled)
      })
      .catch(() => {
        // Network/parse failure - fail closed (not entitled) rather than
        // silently granting access to the editor on an error.
        if (!cancelled) setCafeTvEntitled(false)
      })

    Promise.all([cafeSettingsLoaded, entitlementLoaded]).finally(() => {
      if (!cancelled) setLoading(false)
    })

    // Session-scoped fetch, not the Host-resolved PUBLIC_CONFIG_URL this
    // used to call - keeps this preview's branding/notices, and the
    // camera list offered in the Carousel Slots editor's Source dropdown
    // below, correct for whatever org this admin's session is actually
    // switched to (see the leak this replaces in mediaData's own
    // comment above). Also the source of mediaData for PreviewContent's
    // MediaPanel calls.
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (data.airfieldName) setAirfieldName(data.airfieldName as string)
        if (data.logoUrl) setLogoUrl(data.logoUrl as string)
        if (data.opsPanel?.safetyNotices) setSafetyNotices(data.opsPanel.safetyNotices)
        if (data.gasPrices) setGasPrices(data.gasPrices)
        // Merges legacy camera_slots (`slot` set) with the newer cameras
        // table (migration 0047, `cameraId` set) - see CameraOption's
        // own comment for why these live in one array.
        {
          const legacy = (data.cameraSlots ?? []).map((c: { slot: number; label: string; url: string }) => ({
            slot: c.slot,
            cameraId: null,
            label: c.label,
            url: c.url,
          }))
          const newCameras = (data.cameras ?? []).map((c: { id: string; label: string; url: string | null }) => ({
            slot: null,
            cameraId: c.id,
            label: c.label,
            url: c.url,
          }))
          setCameraOptions([...legacy, ...newCameras].filter((c: CameraOption) => c.url))
        }
        setMediaData({
          cameraSlots: Array.isArray(data.cameraSlots) ? data.cameraSlots : [],
          carouselSlots: Array.isArray(data.carouselSlots) ? data.carouselSlots : [],
          cafeCarouselSlots: Array.isArray(data.cafeCarouselSlots) ? data.cafeCarouselSlots : [],
        })
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

  // Ticker fields deliberately omitted - no longer editable from this
  // page (see TickerSettingsCards.tsx, now on Dashboard Manager).
  // cafe-settings' own PUT is a fetch-current-merge-write-back (each
  // field falls back to whatever's already stored if omitted), so this
  // never touches/overwrites whatever the ticker is currently set to.
  async function handleSave() {
    setSaveStatus('working')
    try {
      const response = await fetch(CAFE_SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layoutMode,
          adLabelEnabled,
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
    if (value === 'gyropedia') {
      saveCafeSlot({ ...slot, mediaType: 'gyropedia', mediaLibraryId: null, cameraSlotNumber: null, cameraId: null })
      return
    }
    if (value.startsWith('webcam:cam:')) {
      const cameraId = value.slice('webcam:cam:'.length)
      saveCafeSlot({ ...slot, mediaType: 'webcam', cameraId, cameraSlotNumber: null, mediaLibraryId: null })
      return
    }
    if (value.startsWith('webcam:')) {
      const cameraSlotNumber = Number(value.slice('webcam:'.length))
      saveCafeSlot({ ...slot, mediaType: 'webcam', cameraSlotNumber, cameraId: null, mediaLibraryId: null })
      return
    }
    if (value.startsWith('file:')) {
      const fileId = value.slice('file:'.length)
      const file = files.find((f) => f.id === fileId)
      if (!file) return
      saveCafeSlot({ ...slot, mediaType: file.mediaType, mediaLibraryId: fileId, cameraSlotNumber: null, cameraId: null })
      return
    }
    saveCafeSlot({ ...slot, mediaType: 'image', mediaLibraryId: null, cameraSlotNumber: null, cameraId: null })
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

  // Whole feature is gated, not just the slot editor - none of this
  // page's other settings (layout, ticker, notices) are useful for a
  // display the tenant can't turn on, so there's nothing worth showing
  // alongside the upsell panel.
  if (!cafeTvEntitled) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-black uppercase tracking-wide text-primary">Cafe Media</h1>
        <FeatureUpsellPanel
          title="Café/Clubhouse Screen Display"
          description="Café and clubhouse screen displays (including advertising) are an additional, separate subscription feature and aren't included on your current plan."
          ctaLabel="Learn more / upgrade"
          ctaHref="/upgrade/cafe-display"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Cafe Media</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Settings for the Café dashboard template - split/full layout and the advertisement label. The preview
        below updates as you configure things, using this tenant's real live weather and notices - nothing is
        saved until you click "Save Settings". Footer ticker settings moved to Dashboard Manager (now available
        to every tenant, not just café) - the preview below still shows it exactly as it'll appear live.
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
              gasPrices={gasPrices}
              cafeSlotsRefreshSignal={cafeSlotsRefreshSignal}
              mediaData={mediaData}
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
