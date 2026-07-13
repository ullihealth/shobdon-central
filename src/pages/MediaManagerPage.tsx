import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { CarouselSlot, CropRect, MediaLibraryFile } from '../types/mediaLibrary'
import { CAROUSEL_SLOTS_URL, MEDIA_LIBRARY_UPLOAD_URL, MEDIA_LIBRARY_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'
import MediaSlotRenderer, { type MediaSlotVisual } from '../components/media/MediaSlotRenderer'

// Dynamic import - this is what keeps fabric.js and the self-hosted
// slide fonts (~90KB+ gzipped combined) out of every bundle except the
// one fetched when a media-manager user actually clicks "Create Slide"/
// "Edit Slide". The public dashboard route never renders this page at
// all, and even here on /media-manager the chunk isn't fetched until
// the editor is actually opened.
const SlideEditor = lazy(() => import('../components/media/SlideEditor'))

interface CameraOption {
  slot: number
  label: string
  url: string
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Real visual preview per file so entries are distinguishable at a glance,
// not just by filename - image gets an actual <img>, mp4 gets a muted
// <video> (browsers render its first frame once metadata loads, giving a
// genuine video-frame thumbnail with no extra decoding work), pdf gets a
// plain document glyph since there's no lightweight way to rasterise a
// PDF's first page client-side.
function FileThumbnail({ file }: { file: MediaLibraryFile }): JSX.Element {
  const boxClass = 'flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-800'

  if (file.mediaType === 'image' && file.url) {
    return (
      <div className={boxClass}>
        <img src={file.url} alt="" className="h-full w-full object-cover" />
      </div>
    )
  }
  if (file.mediaType === 'mp4' && file.url) {
    return (
      <div className={boxClass}>
        <video src={file.url} className="h-full w-full object-cover" muted preload="metadata" />
      </div>
    )
  }
  return (
    <div className={boxClass}>
      <span className="text-2xl">{file.mediaType === 'pdf' ? '📄' : file.mediaType === 'mp4' ? '🎬' : '🖼️'}</span>
    </div>
  )
}

// Detects an mp4's real length client-side before upload, via an off-DOM
// <video> element's loadedmetadata event - the standard, and really
// only sane, way to do this without a server-side video-parsing library.
function probeMp4Duration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve(Number.isFinite(video.duration) ? video.duration : null)
    }
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      resolve(null)
    }
    video.src = URL.createObjectURL(file)
  })
}

function mediaTypeFromFile(file: File): 'image' | 'mp4' | 'pdf' | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'video/mp4') return 'mp4'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

// Encodes a slot's current source (library file or webcam) as one
// <select> value - simplest way to offer a single unified picker instead
// of two separate "pick a file" / "pick a webcam" controls that would
// need to stay in sync with each other.
function sourceValueFor(slot: CarouselSlot): string {
  if (slot.mediaType === 'webcam' && slot.cameraSlotNumber) return `webcam:${slot.cameraSlotNumber}`
  if (slot.mediaLibraryId) return `file:${slot.mediaLibraryId}`
  return ''
}

// Builds the exact same shape MediaSlotRenderer consumes on the live
// dashboard (MediaPanel.tsx) - the editor preview calls the identical
// component with identical props, so it's a genuine preview, not a
// lookalike. resolvedUrl is computed client-side here from the already-
// loaded library/webcam lists rather than round-tripping through the
// public config endpoint, since the assigned file may not be saved yet.
function resolveSlotVisual(
  slot: CarouselSlot,
  files: MediaLibraryFile[],
  cameraOptions: CameraOption[]
): MediaSlotVisual {
  const resolvedUrl =
    slot.mediaType === 'webcam'
      ? cameraOptions.find((c) => c.slot === slot.cameraSlotNumber)?.url ?? null
      : files.find((f) => f.id === slot.mediaLibraryId)?.url ?? null
  return {
    mediaType: slot.mediaType,
    resolvedUrl,
    fitMode: slot.fitMode,
    cropRect: slot.cropRect,
    rotationDegrees: slot.rotationDegrees,
    brightnessPercent: slot.brightnessPercent,
    bannerText: slot.bannerText,
    bannerOpacity: slot.bannerOpacity,
    bannerFontSize: slot.bannerFontSize,
  }
}

const IDENTITY_APPEARANCE: Pick<
  CarouselSlot,
  'cropRect' | 'rotationDegrees' | 'brightnessPercent' | 'bannerText' | 'bannerOpacity' | 'bannerFontSize'
> = {
  cropRect: { x: 0, y: 0, width: 100, height: 100 },
  rotationDegrees: 0,
  brightnessPercent: 100,
  bannerText: '',
  bannerOpacity: 70,
  bannerFontSize: 'md',
}

const ZOOM_MIN = 100
const ZOOM_MAX = 300

// The 4 independent X/Y/Width/Height crop sliders this replaced were
// unusable for non-technical users: each started at an edge-case value
// (0%/0%/100%/100%), so any small nudge combined with cover-fit
// rendering produced a jarring, unpredictable resize rather than a
// smooth change. Zoom + pan is the standard, intuitive mental model
// (100% = whole image visible, higher = zoomed in; position = where the
// zoomed view sits) - and it maps cleanly onto the SAME underlying
// cropRect the schema and MediaSlotRenderer already use, so nothing
// downstream of "what gets saved" needs to change. Zoom always crops a
// square-in-source-percentage window (width === height) since these
// controls don't offer independent aspect adjustment - only the crop
// tool that generated arbitrary rects did, and that's exactly what
// made it unpredictable.
function cropToZoomPan(crop: CropRect): { zoom: number; hPan: number; vPan: number } {
  const width = crop.width || 100
  const height = crop.height || 100
  const zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, 10000 / width)))
  const marginX = 100 - width
  const marginY = 100 - height
  const hPan = marginX > 0.01 ? Math.round((crop.x / marginX) * 200 - 100) : 0
  const vPan = marginY > 0.01 ? Math.round((crop.y / marginY) * 200 - 100) : 0
  return { zoom, hPan: Math.min(100, Math.max(-100, hPan)), vPan: Math.min(100, Math.max(-100, vPan)) }
}

function zoomPanToCrop(zoom: number, hPan: number, vPan: number): CropRect {
  const size = 10000 / Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
  const margin = 100 - size
  const x = (margin * (Math.min(100, Math.max(-100, hPan)) + 100)) / 200
  const y = (margin * (Math.min(100, Math.max(-100, vPan)) + 100)) / 200
  return { x, y, width: size, height: size }
}

function RangeField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent-sky-500"
      />
    </label>
  )
}

// Zoom/pan control: a slider for coarse adjustment plus +/- steppers for
// fine 1%-at-a-time nudges, both driving the same value - exactly the
// dual-input pattern requested, factored out since zoom/hPan/vPan all
// need it identically.
function SteppedRangeField({
  label,
  min,
  max,
  value,
  suffix = '%',
  onChange,
}: {
  label: string
  min: number
  max: number
  value: number
  suffix?: string
  onChange: (value: number) => void
}): JSX.Element {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
        {label}: {value}
        {suffix}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/80 text-sm font-bold text-white hover:border-sky-500"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
          className="w-full accent-accent-sky-500"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/80 text-sm font-bold text-white hover:border-sky-500"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  )
}

// One combined edit panel per slot: a live preview (rendered with the
// exact same MediaSlotRenderer component the public dashboard uses) plus
// crop/rotate/brightness/banner controls, all reflected in that same
// preview instantly - every control writes through the parent's saveSlot
// (synchronous local state update, debounced network write), so there's
// no separate "draft" state to reconcile before saving.
function SlotAppearanceEditor({
  slot,
  visual,
  onChange,
}: {
  slot: CarouselSlot
  visual: MediaSlotVisual
  onChange: (patch: Partial<CarouselSlot>) => void
}): JSX.Element {
  const { zoom, hPan, vPan } = cropToZoomPan(slot.cropRect)
  const updateZoomPan = (nextZoom: number, nextHPan: number, nextVPan: number) =>
    onChange({ cropRect: zoomPanToCrop(nextZoom, nextHPan, nextVPan) })
  const hasBanner = slot.bannerText.trim().length > 0

  return (
    <div className="mt-3 rounded-xl border border-dashed border-accent-sky-500/40 bg-slate-950/40 p-3">
      {/* Same outer/inner wrapper classes as MediaPanel.tsx's live dashboard
          box (aspect-video 16:9, identical border/background/rounding) -
          only the rendering component inside (MediaSlotRenderer) is what
          must match exactly, but matching the frame too makes this a
          visually honest preview, not just a technically-accurate one. */}
      <div className="mb-3 aspect-video w-full overflow-hidden rounded-xl border border-border bg-slate-950/90 shadow-lg shadow-slate-950/30">
        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-slate-900/60">
          {visual.resolvedUrl ? (
            <MediaSlotRenderer slot={visual} />
          ) : (
            <span className="px-4 text-center text-xs text-muted-500">Assign a source above to preview</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        <SteppedRangeField
          label="Zoom"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          value={zoom}
          onChange={(v) => updateZoomPan(v, hPan, vPan)}
        />
        <SteppedRangeField
          label="Horizontal position"
          min={-100}
          max={100}
          value={hPan}
          onChange={(v) => updateZoomPan(zoom, v, vPan)}
        />
        <SteppedRangeField
          label="Vertical position"
          min={-100}
          max={100}
          value={vPan}
          onChange={(v) => updateZoomPan(zoom, hPan, v)}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <RangeField
          label={`Rotation: ${slot.rotationDegrees}°`}
          min={-180}
          max={180}
          value={slot.rotationDegrees}
          onChange={(v) => onChange({ rotationDegrees: v })}
        />
        <RangeField
          label={`Brightness: ${slot.brightnessPercent}%`}
          min={20}
          max={200}
          value={slot.brightnessPercent}
          onChange={(v) => onChange({ brightnessPercent: v })}
        />
      </div>

      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Banner text (optional)</span>
        <input
          type="text"
          value={slot.bannerText}
          onChange={(event) => onChange({ bannerText: event.target.value })}
          placeholder="e.g. Duty Instructor"
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </label>

      {hasBanner && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <RangeField
            label={`Banner opacity: ${slot.bannerOpacity}%`}
            min={0}
            max={100}
            value={slot.bannerOpacity}
            onChange={(v) => onChange({ bannerOpacity: v })}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Banner size</span>
            <select
              value={slot.bannerFontSize}
              onChange={(event) => onChange({ bannerFontSize: event.target.value as CarouselSlot['bannerFontSize'] })}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
              <option value="xl">Extra large</option>
              <option value="xxl">Max</option>
            </select>
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange(IDENTITY_APPEARANCE)}
        className="mt-3 text-xs font-semibold text-muted-400 hover:text-status-bad"
      >
        Reset appearance to defaults
      </button>
    </div>
  )
}

// Resolves the human-readable label shown in the compact slot list row -
// webcam label, assigned library filename, or "— none —" when
// unassigned. Pure lookup, no state of its own.
function slotSourceLabel(slot: CarouselSlot, files: MediaLibraryFile[], cameraOptions: CameraOption[]): string {
  if (slot.mediaType === 'webcam') {
    return cameraOptions.find((c) => c.slot === slot.cameraSlotNumber)?.label ?? `Webcam ${slot.cameraSlotNumber ?? '?'}`
  }
  return files.find((f) => f.id === slot.mediaLibraryId)?.filename ?? '— none —'
}

// Compact always-visible list of all 12 slots - replaces the old grid of
// 12 fully-expanded cards. Each row's Enabled checkbox calls onToggleEnabled
// directly (the same saveSlot() write the old inline checkbox used),
// independent of which slot is currently selected for the shared editor
// below - toggling slot 7 while slot 3 is open in the editor must not
// require selecting slot 7 first. stopPropagation on the checkbox keeps a
// toggle click from also firing the row's onSelect.
function CarouselSlotList({
  slots,
  files,
  cameraOptions,
  selectedSlotNumber,
  onSelect,
  onToggleEnabled,
}: {
  slots: CarouselSlot[]
  files: MediaLibraryFile[]
  cameraOptions: CameraOption[]
  selectedSlotNumber: number
  onSelect: (slotNumber: number) => void
  onToggleEnabled: (slot: CarouselSlot, enabled: boolean) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {slots.map((slot) => {
        const isSelected = slot.slotNumber === selectedSlotNumber
        return (
          <div
            key={slot.slotNumber}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(slot.slotNumber)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(slot.slotNumber)
              }
            }}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
              isSelected ? 'border-accent-sky-500 bg-accent-sky-500/10' : 'border-border bg-card hover:border-slate-600'
            }`}
          >
            <span className="w-5 flex-shrink-0 text-right text-xs font-bold text-muted-400">{slot.slotNumber}</span>
            <input
              type="checkbox"
              checked={slot.enabled}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation()
                onToggleEnabled(slot, event.target.checked)
              }}
              className="h-4 w-4 flex-shrink-0"
              aria-label={`Slot ${slot.slotNumber} enabled`}
            />
            <span
              className={`min-w-0 flex-1 truncate text-sm ${isSelected ? 'font-semibold text-white' : 'text-muted-300'}`}
            >
              {slotSourceLabel(slot, files, cameraOptions)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// The single shared editor panel - today's per-card body (Source,
// Duration, Fit Mode, Edit appearance) lifted out of the old 12x .map()
// loop, parameterized by whichever one slot is currently selected instead
// of implicitly closing over a loop variable. SlotAppearanceEditor,
// sourceValueFor, and resolveSlotVisual are reused completely unmodified -
// no editing logic changes, only where this JSX is instantiated from.
function CarouselSlotEditor({
  slot,
  files,
  cameraOptions,
  appearanceOpen,
  onToggleAppearance,
  onSourceChange,
  onChange,
}: {
  slot: CarouselSlot
  files: MediaLibraryFile[]
  cameraOptions: CameraOption[]
  appearanceOpen: boolean
  onToggleAppearance: () => void
  onSourceChange: (value: string) => void
  onChange: (patch: Partial<CarouselSlot>) => void
}): JSX.Element {
  const file = files.find((f) => f.id === slot.mediaLibraryId)
  const isMp4 = slot.mediaType === 'mp4'
  const showAppearanceControls = slot.mediaType === 'image' || slot.mediaType === 'mp4'

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Slot {slot.slotNumber}</div>

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Source</span>
        <select
          value={sourceValueFor(slot)}
          onChange={(event) => onSourceChange(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="">— none —</option>
          {cameraOptions.length > 0 && (
            <optgroup label="Webcams">
              {cameraOptions.map((cam) => (
                <option key={cam.slot} value={`webcam:${cam.slot}`}>
                  {cam.label}
                </option>
              ))}
            </optgroup>
          )}
          {files.length > 0 && (
            <optgroup label="Media library">
              {files.map((f) => (
                <option key={f.id} value={`file:${f.id}`}>
                  {f.filename} ({f.mediaType})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Duration (seconds)</span>
        {isMp4 ? (
          <input
            type="text"
            readOnly
            value={file?.mp4DurationSeconds ? `Detected: ${file.mp4DurationSeconds.toFixed(1)}s` : 'Detected on upload'}
            className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm text-muted-400"
          />
        ) : (
          <input
            type="number"
            min={1}
            value={slot.durationSeconds}
            onChange={(event) => onChange({ durationSeconds: Number(event.target.value) || 10 })}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        )}
      </label>

      {showAppearanceControls && (
        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Fit mode</span>
          <select
            value={slot.fitMode}
            onChange={(event) => onChange({ fitMode: event.target.value as CarouselSlot['fitMode'] })}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="contain">Fit (show whole image, letterboxed if needed)</option>
            <option value="fill">Fill (crop to fill the box)</option>
          </select>
        </label>
      )}

      {showAppearanceControls && (
        <button
          type="button"
          onClick={onToggleAppearance}
          className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 transition hover:border-sky-500"
        >
          {appearanceOpen ? '▾ Close appearance editor' : '🎨 Edit appearance'}
        </button>
      )}

      {appearanceOpen && showAppearanceControls && (
        <SlotAppearanceEditor
          slot={slot}
          visual={resolveSlotVisual(slot, files, cameraOptions)}
          onChange={onChange}
        />
      )}
    </div>
  )
}

export default function MediaManagerPage(): JSX.Element {
  const [files, setFiles] = useState<MediaLibraryFile[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [capBytes, setCapBytes] = useState(100 * 1024 * 1024)
  const [slots, setSlots] = useState<CarouselSlot[]>([])
  const [cameraOptions, setCameraOptions] = useState<CameraOption[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // selectedSlotNumber: which slot the single shared editor panel is
  // currently showing (defaults to 1, so the panel is never blank).
  // appearanceEditorOpen: whether that slot's crop/rotate/banner
  // sub-panel is expanded - always resets to closed on every slot
  // switch, matching the old per-card behaviour where opening one
  // card's appearance editor never left another slot's expanded.
  const [selectedSlotNumber, setSelectedSlotNumber] = useState<number>(1)
  const [appearanceEditorOpen, setAppearanceEditorOpen] = useState(false)
  // null = closed; a MediaLibraryFile (with a recipe) = re-editing that
  // slide; an empty-shell value would be wrong here - "create new" is
  // represented by the boolean below instead, since there's no existing
  // file/recipe to point at yet.
  const [editingSlideFile, setEditingSlideFile] = useState<MediaLibraryFile | null>(null)
  const [creatingSlide, setCreatingSlide] = useState(false)
  const pendingSavesRef = useRef<Map<number, CarouselSlot>>(new Map())
  const saveTimerRef = useRef<number | undefined>(undefined)

  function loadLibrary() {
    return fetch(MEDIA_LIBRARY_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return
        setFiles(data.files ?? [])
        setTotalBytes(data.totalBytes ?? 0)
        setCapBytes(data.capBytes ?? capBytes)
      })
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

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const mediaType = mediaTypeFromFile(file)
    if (!mediaType) {
      setUploadError('Unsupported file type - only images, MP4 video, and PDF are supported.')
      return
    }

    setUploading(true)
    setUploadError(null)

    const mp4DurationSeconds = mediaType === 'mp4' ? await probeMp4Duration(file) : null

    const params = new URLSearchParams({ filename: file.name, mediaType })
    if (mp4DurationSeconds !== null) params.set('mp4DurationSeconds', String(mp4DurationSeconds))

    try {
      const response = await fetch(`${MEDIA_LIBRARY_UPLOAD_URL}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      const data = await response.json()
      if (!response.ok) {
        setUploadError(data.error ?? 'Upload failed')
        return
      }
      await loadLibrary()
    } catch {
      setUploadError('Upload failed - check your connection and try again')
    } finally {
      setUploading(false)
    }
  }

  // "Save Slide" on an existing slide updates that file in place;
  // "Save as New" (or the initial "Create Slide") always creates a
  // fresh library entry - see SlideEditor.tsx's performSave(). Either
  // way, reloading from the server guarantees the list reflects
  // exactly what's actually stored, including the parsed slideRecipe.
  // Deliberately does NOT close the editor itself - SlideEditor closes
  // on full success, but keeps itself open (with the save already safely
  // done and this reload already run) if only the recipe-attach step
  // failed, so its warning message is actually visible before the user
  // dismisses it.
  function handleSlideSaved() {
    loadLibrary()
  }

  function closeSlideEditor() {
    setCreatingSlide(false)
    setEditingSlideFile(null)
  }

  async function handleDeleteFile(file: MediaLibraryFile) {
    setDeleteError(null)
    if (!window.confirm(`Delete "${file.filename}"? This can't be undone.`)) return

    const response = await fetch(`${MEDIA_LIBRARY_URL}/${file.id}`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setDeleteError(data.error ?? 'Delete failed')
      return
    }
    await loadLibrary()
  }

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

  return (
    <>
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Media Manager</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Upload images, MP4 clips, and PDFs to the media library, then assign them to any of the 12 carousel
          slots. Slots cycle in order on the live dashboard, each for its own duration - plain cuts between
          slots for now, no fade/swipe transitions yet.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            {/* ── Media Library ───────────────────────────────────────── */}
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Media Library</div>
                <div className="text-xs text-muted-400">
                  {formatMb(totalBytes)} of {formatMb(capBytes)} used
                </div>
              </div>
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-accent-sky-500"
                  style={{ width: `${Math.min(100, (totalBytes / capBytes) * 100)}%` }}
                />
              </div>

              <div className="mb-4 flex flex-wrap gap-3">
                <label className="inline-block cursor-pointer rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400">
                  {uploading ? 'Uploading…' : '+ Upload file'}
                  <input
                    type="file"
                    accept="image/*,video/mp4,application/pdf"
                    onChange={handleUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setCreatingSlide(true)}
                  className="rounded-lg border border-accent-sky-500/60 bg-slate-900/40 px-4 py-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400 transition hover:border-accent-sky-400"
                >
                  ✨ Create Slide
                </button>
              </div>
              {uploadError && <p className="mb-4 text-sm font-semibold text-status-bad">{uploadError}</p>}
              {deleteError && <p className="mb-4 text-sm font-semibold text-status-bad">{deleteError}</p>}

              {files.length === 0 ? (
                <p className="text-sm text-muted-500">No files uploaded yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <FileThumbnail file={file} />
                        <div>
                          <div className="text-sm font-semibold text-white">{file.filename}</div>
                          <div className="text-xs text-muted-500">
                            {file.mediaType}
                            {file.mediaType === 'mp4' && file.mp4DurationSeconds ? ` · ${file.mp4DurationSeconds.toFixed(1)}s` : ''}
                            {' · '}
                            {formatMb(file.sizeBytes)} · uploaded {formatDate(file.uploadedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {file.slideRecipe && (
                          <button
                            type="button"
                            onClick={() => setEditingSlideFile(file)}
                            className="text-xs font-semibold text-accent-sky-400"
                          >
                            ✏️ Edit Slide
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteFile(file)}
                          className="text-xs font-semibold text-status-bad"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Carousel Slots ──────────────────────────────────────── */}
            <section className="rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                Carousel Slots
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
                    files={files}
                    cameraOptions={cameraOptions}
                    appearanceOpen={appearanceEditorOpen}
                    onToggleAppearance={() => setAppearanceEditorOpen((prev) => !prev)}
                    onSourceChange={(value) => handleSourceChange(selectedSlot, value)}
                    onChange={(patch) => saveSlot({ ...selectedSlot, ...patch })}
                  />
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {(creatingSlide || editingSlideFile) && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
              <p className="text-sm font-semibold text-muted-300">Loading slide editor…</p>
            </div>
          }
        >
          <SlideEditor
            files={files}
            editingFile={editingSlideFile}
            onClose={closeSlideEditor}
            onSaved={handleSlideSaved}
            onLibraryChanged={loadLibrary}
          />
        </Suspense>
      )}
    </>
  )
}
