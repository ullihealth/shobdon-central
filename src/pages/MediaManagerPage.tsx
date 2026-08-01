import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'
import { CAROUSEL_SLOTS_URL, GAS_PRICES_URL, MEDIA_LIBRARY_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
import { CarouselSlotEditor, CarouselSlotList, filterAssetsForScreen, type CameraOption } from '../components/media/CarouselSlotEditor'

const CURRENCY_OPTIONS = ['£', '$', '€']

// Task #42 - Dashboard Manager's dedicated Gas Prices container. Prices
// are kept as free-typed strings locally (so e.g. a trailing "1." or an
// in-progress "1.8" isn't fought by the input while typing) and only
// parsed to number|null at save time - null (not 0) means "not set",
// matching gas_prices' own nullable columns (see that migration's
// comment) so an unset price shows no tile at all on the live dashboard
// rather than a fake "£0.00".
interface GasPricesState {
  avgasPrice: string
  ul91Price: string
  jetA1Price: string
  currency: string
}

const DEFAULT_GAS_PRICES_STATE: GasPricesState = { avgasPrice: '', ul91Price: '', jetA1Price: '', currency: '£' }

function priceToInputValue(value: number | null): string {
  return value === null ? '' : String(value)
}

function inputValueToPrice(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

// Now JUST the Carousel Slots section - the embedded Media Library
// (folders, upload, move-to-folder, Edit Slide, delete) moved to its own
// page (MediaLibraryPage.tsx, /media-library) shared with Cafe Media's
// own new Carousel Slots section. `files` is still fetched here (read-
// only, for the Source dropdown), just no longer edited from this page.
export default function MediaManagerPage(): JSX.Element {
  const [files, setFiles] = useState<MediaLibraryFile[]>([])
  const [slots, setSlots] = useState<CarouselSlot[]>([])
  const [cameraOptions, setCameraOptions] = useState<CameraOption[]>([])
  const [loading, setLoading] = useState(true)
  // selectedSlotNumber: which slot the single shared editor panel is
  // currently showing (defaults to 1, so the panel is never blank).
  // appearanceEditorOpen: whether that slot's crop/rotate/banner
  // sub-panel is expanded - always resets to closed on every slot
  // switch.
  const [selectedSlotNumber, setSelectedSlotNumber] = useState<number>(1)
  const [appearanceEditorOpen, setAppearanceEditorOpen] = useState(false)
  const pendingSavesRef = useRef<Map<number, CarouselSlot>>(new Map())
  const saveTimerRef = useRef<number | undefined>(undefined)
  const [gasPrices, setGasPrices] = useState<GasPricesState>(DEFAULT_GAS_PRICES_STATE)
  const gasPricesSaveTimerRef = useRef<number | undefined>(undefined)

  function loadLibrary() {
    return fetch(MEDIA_LIBRARY_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setFiles(data?.files ?? []))
  }

  function loadSlots() {
    return fetch(CAROUSEL_SLOTS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSlots(data?.slots ?? []))
  }

  function loadGasPrices() {
    return fetch(GAS_PRICES_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return
        setGasPrices({
          avgasPrice: priceToInputValue(data.avgasPrice),
          ul91Price: priceToInputValue(data.ul91Price),
          jetA1Price: priceToInputValue(data.jetA1Price),
          currency: data.currency ?? '£',
        })
      })
  }

  function loadCameraOptions() {
    // Camera URLs are already fully public (embedded as iframes on the
    // unauthenticated dashboard), so reusing the public config endpoint
    // here is not a new exposure - and it's readable by both owner and
    // media roles, unlike the owner-only /api/tenant/config. Merges the
    // legacy camera_slots list (cameraSlots, `slot` set) with the newer
    // cameras table (migration 0047, `cameraId` set) - see
    // CameraOption's own comment for why these live in one array.
    return fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const legacy = (data?.cameraSlots ?? []).map((c: { slot: number; label: string; url: string }) => ({
          slot: c.slot,
          cameraId: null,
          label: c.label,
          url: c.url,
        }))
        const newCameras = (data?.cameras ?? []).map((c: { id: string; label: string; url: string | null }) => ({
          slot: null,
          cameraId: c.id,
          label: c.label,
          url: c.url,
        }))
        setCameraOptions([...legacy, ...newCameras].filter((c: CameraOption) => c.url))
      })
  }

  useEffect(() => {
    Promise.all([loadLibrary(), loadSlots(), loadCameraOptions(), loadGasPrices()]).finally(() => setLoading(false))
  }, [])

  // Local state (hence the live preview) updates synchronously on every
  // call; the network PUT is batched and debounced so dragging a crop/
  // rotation/brightness slider doesn't fire a request per pixel - all
  // slots edited within the debounce window are flushed together in one
  // request, keyed by slotNumber so rapid edits to the same slot collapse
  // to their latest value rather than being sent (and potentially
  // resolved out of order) individually.
  function saveSlot(updated: CarouselSlot) {
    setSlots((prev) => prev.map((s) => (s.slotNumber === updated.slotNumber ? updated : s)))
    pendingSavesRef.current.set(updated.slotNumber, updated)
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      const toSave = Array.from(pendingSavesRef.current.values())
      pendingSavesRef.current.clear()
      if (toSave.length === 0) return
      fetch(CAROUSEL_SLOTS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: toSave }),
      })
    }, 300)
  }

  // Same debounced-save shape as saveSlot above (local state updates
  // synchronously for a live-feeling input; the network PUT is debounced
  // so typing a price doesn't fire a request per keystroke), just for
  // one shared row instead of a per-slot map.
  function updateGasPrices(patch: Partial<GasPricesState>) {
    const next = { ...gasPrices, ...patch }
    setGasPrices(next)
    window.clearTimeout(gasPricesSaveTimerRef.current)
    gasPricesSaveTimerRef.current = window.setTimeout(() => {
      fetch(GAS_PRICES_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avgasPrice: inputValueToPrice(next.avgasPrice),
          ul91Price: inputValueToPrice(next.ul91Price),
          jetA1Price: inputValueToPrice(next.jetA1Price),
          currency: next.currency,
        }),
      })
    }, 300)
  }

  function handleSourceChange(slot: CarouselSlot, value: string) {
    if (value.startsWith('webcam:cam:')) {
      const cameraId = value.slice('webcam:cam:'.length)
      saveSlot({ ...slot, mediaType: 'webcam', cameraId, cameraSlotNumber: null, mediaLibraryId: null })
      return
    }
    if (value.startsWith('webcam:')) {
      const cameraSlotNumber = Number(value.slice('webcam:'.length))
      saveSlot({ ...slot, mediaType: 'webcam', cameraSlotNumber, cameraId: null, mediaLibraryId: null })
      return
    }
    if (value.startsWith('file:')) {
      const fileId = value.slice('file:'.length)
      const file = files.find((f) => f.id === fileId)
      if (!file) return
      saveSlot({ ...slot, mediaType: file.mediaType, mediaLibraryId: fileId, cameraSlotNumber: null, cameraId: null })
      return
    }
    saveSlot({ ...slot, mediaType: 'image', mediaLibraryId: null, cameraSlotNumber: null, cameraId: null })
  }

  // Deliberately does NOT touch appearanceEditorOpen - same fix as
  // CafeMediaPage.tsx's selectCafeSlot (shared CarouselSlotEditor
  // component, same defect): force-closing it here unmounted the
  // appearance editor's preview <img> the instant a different slot was
  // picked while it was already open, requiring a manual reopen to see
  // the new slot. Leaving the open/closed state alone lets an
  // already-open editor keep showing whatever slot is now selected.
  function selectSlot(slotNumber: number) {
    setSelectedSlotNumber(slotNumber)
  }

  const selectedSlot = slots.find((s) => s.slotNumber === selectedSlotNumber) ?? null
  // Source dropdown only offers assets tagged for the dashboard (or
  // 'both') - CarouselSlotList (the compact 12-row list) still gets the
  // FULL, unfiltered `files` below, so an already-assigned file that's
  // since been retagged away from 'dashboard' still resolves its label
  // correctly instead of going blank.
  const dashboardFiles = filterAssetsForScreen(files, 'dashboard')

  return (
    <div className="mx-auto max-w-6xl px-5 pb-16 pt-10">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Dashboard Manager</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-400">
        Assign media to any of the 12 carousel slots below. Slots cycle in order on the live dashboard, each for
        its own duration - plain cuts between slots for now, no fade/swipe transitions yet. Upload files, organize
        folders, and edit slides on the{' '}
        <Link to="/media-library" className="font-semibold text-accent-sky-400 hover:underline">
          Media Library
        </Link>{' '}
        page.
      </p>

      {loading ? (
        <p className="text-sm text-muted-400">Loading…</p>
      ) : (
        <section className="rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Carousel Slots</div>
            <Link
              to="/media-library"
              className="text-xs font-semibold text-accent-sky-400 hover:underline"
            >
              Manage Media Library →
            </Link>
          </div>
          {/* Compact always-visible list of all 12 slots + one shared editor
              panel for whichever slot is selected - replaces the old grid of
              12 fully-expanded cards. Stacks (list above editor) below the
              lg breakpoint since the editor's own 3-column zoom/pan grid
              needs real width to not feel cramped. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
            <CarouselSlotList
              slots={slots}
              files={files}
              cameraOptions={cameraOptions}
              selectedSlotNumber={selectedSlotNumber}
              onSelect={selectSlot}
              onToggleEnabled={(slot, enabled) => saveSlot({ ...slot, enabled })}
            />
            {selectedSlot && (
              <CarouselSlotEditor
                slot={selectedSlot}
                files={dashboardFiles}
                cameraOptions={cameraOptions}
                appearanceOpen={appearanceEditorOpen}
                onToggleAppearance={() => setAppearanceEditorOpen((prev) => !prev)}
                onSourceChange={(value) => handleSourceChange(selectedSlot, value)}
                onChange={(patch) => saveSlot({ ...selectedSlot, ...patch })}
              />
            )}
          </div>
        </section>
      )}

      {!loading && (
        <section className="mt-8 rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Fuel Prices</div>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-400">
              Currency
              <select
                value={gasPrices.currency}
                onChange={(event) => updateGasPrices({ currency: event.target.value })}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-white focus:border-sky-500 focus:outline-none"
              >
                {CURRENCY_OPTIONS.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mb-4 max-w-2xl text-sm text-muted-400">
            Shown as their own compact tile row above the Ops Panel on the live dashboard. Leave a field blank to
            hide that fuel's tile entirely rather than showing a price of zero.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                { key: 'avgasPrice', label: 'Avgas' },
                { key: 'ul91Price', label: 'UL91' },
                { key: 'jetA1Price', label: 'Jet A1' },
              ] as const
            ).map((row) => (
              <div key={row.key}>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-500">{row.label}</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-400">{gasPrices.currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="Not set"
                    value={gasPrices[row.key]}
                    onChange={(event) => updateGasPrices({ [row.key]: event.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
