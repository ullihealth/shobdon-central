import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'
import { CAROUSEL_SLOTS_URL, MEDIA_LIBRARY_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
import { CarouselSlotEditor, CarouselSlotList, filterAssetsForScreen, type CameraOption } from '../components/media/CarouselSlotEditor'

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

  function loadCameraOptions() {
    // Camera URLs are already fully public (embedded as iframes on the
    // unauthenticated dashboard), so reusing the public config endpoint
    // here is not a new exposure - and it's readable by both owner and
    // media roles, unlike the owner-only /api/tenant/config.
    return fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setCameraOptions((data?.cameraSlots ?? []).filter((c: CameraOption) => c.url)))
  }

  useEffect(() => {
    Promise.all([loadLibrary(), loadSlots(), loadCameraOptions()]).finally(() => setLoading(false))
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

  function handleSourceChange(slot: CarouselSlot, value: string) {
    if (value.startsWith('webcam:')) {
      const cameraSlotNumber = Number(value.slice('webcam:'.length))
      saveSlot({ ...slot, mediaType: 'webcam', cameraSlotNumber, mediaLibraryId: null })
      return
    }
    if (value.startsWith('file:')) {
      const fileId = value.slice('file:'.length)
      const file = files.find((f) => f.id === fileId)
      if (!file) return
      saveSlot({ ...slot, mediaType: file.mediaType, mediaLibraryId: fileId, cameraSlotNumber: null })
      return
    }
    saveSlot({ ...slot, mediaType: 'image', mediaLibraryId: null, cameraSlotNumber: null })
  }

  function selectSlot(slotNumber: number) {
    setSelectedSlotNumber(slotNumber)
    setAppearanceEditorOpen(false)
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
    </div>
  )
}
