import type { CarouselSlot, CropRect, MediaLibraryFile } from '../../types/mediaLibrary'
import MediaSlotRenderer, { type MediaSlotVisual } from './MediaSlotRenderer'

// Shared by both Dashboard Manager (/media-manager) and Cafe Media
// (/cafe-media) - originally a single implementation living only in
// MediaManagerPage.tsx, extracted unmodified (behaviour-for-behaviour)
// once Cafe Media gained its own, genuinely separate 12-slot carousel
// (migration 0037, cafe_carousel_slots) that needed the exact same
// editing UI pointed at different data. Neither page duplicates this
// logic - both import CarouselSlotList/CarouselSlotEditor from here and
// pass in their own slots/files/save-handler, matching the same
// "shared component, not a lookalike" approach already established for
// SlideEditor.tsx.

export interface CameraOption {
  slot: number
  label: string
  url: string
}

// Which screen(s) an asset is tagged for (migration 0037) determines
// whether it shows up in a given page's Source dropdown at all; for a
// café slot specifically assigned to a split-pane zone, orientation
// narrows it further. A 'both'-zoned café slot deliberately stays
// unfiltered by orientation - it can end up rendered in full-16:9 OR
// either split zone depending on Cafe Media's current layout mode, so
// restricting it to one shape would be presumptuous. Dashboard slots
// are never orientation-filtered - nothing in this codebase asked for
// that, and the dashboard's own panels don't have café's split-pane
// shape constraint.
export function filterAssetsForScreen(
  files: MediaLibraryFile[],
  screen: 'dashboard' | 'cafe',
  zone?: CarouselSlot['zone']
): MediaLibraryFile[] {
  const screenFiltered = files.filter((f) => f.usableOn === screen || f.usableOn === 'both')
  if (screen !== 'cafe' || !zone || zone === 'both') return screenFiltered
  return screenFiltered.filter((f) => f.orientation === '9:16' || f.orientation === 'both')
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
// unassigned. Pure lookup, no state of its own. Deliberately takes the
// FULL (unfiltered) files list, not whatever screen-filtered subset the
// Source dropdown itself is showing - a slot already assigned to a file
// that's since been retagged out of this screen's filter should still
// resolve its label correctly, not go blank.
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
//
// `files` here should always be the FULL, unfiltered list (see
// slotSourceLabel's own comment) - it's only used for label lookup, not
// for building a picker of available choices.
export function CarouselSlotList({
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
// Duration, Fit Mode, Zone, Edit appearance) lifted out of the old 12x
// .map() loop, parameterized by whichever one slot is currently
// selected instead of implicitly closing over a loop variable.
//
// `files` here should be whatever the CALLING page has already
// filtered via filterAssetsForScreen() above - this component has no
// opinion of its own about which screen it's running in, it just
// renders whatever options it's given (dashboard vs café filtering, and
// café's zone-based orientation narrowing, both live in the parent page
// so this stays a plain, context-free "edit one slot" component).
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
  // webcam included alongside image/mp4 now that MediaSlotRenderer
  // applies the same zoom/pan/rotate transform to it (see that file's
  // supportsCropRotate comment) - lets an admin reposition/zoom the
  // webcam view exactly like any other slot.
  const showAppearanceControls = slot.mediaType === 'image' || slot.mediaType === 'mp4' || slot.mediaType === 'webcam'
  // Fit mode specifically stays image/mp4 only - the webcam <iframe>
  // always renders at a fixed h-full w-full regardless of fitMode (see
  // MediaSlotRenderer's webcam case, which never reads objectFitClass),
  // so showing this control for webcam would be a dead toggle with no
  // visible effect.
  const showFitMode = slot.mediaType === 'image' || slot.mediaType === 'mp4'

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

      {showFitMode && (
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

      {/* Only meaningful for the Café template's split-pane mode - every
          other template ignores this entirely, so it's harmless to leave
          visible/settable regardless of which template a tenant currently
          has selected, and regardless of whether this particular editor
          instance is running on Dashboard Manager or Cafe Media (both
          this dashboard slot AND a café slot can independently carry a
          zone value - see migration 0037's own comment). */}
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Zone (Café split-pane)</span>
        <select
          value={slot.zone}
          onChange={(event) => onChange({ zone: event.target.value as CarouselSlot['zone'] })}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="both">Both</option>
          <option value="left">Left only</option>
          <option value="right">Right only</option>
        </select>
      </label>

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

export { CarouselSlotEditor }
