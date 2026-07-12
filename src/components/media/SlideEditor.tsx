// The slide composer: a Fabric.js canvas editor for building a custom
// slide (solid-colour/existing-image/freshly-uploaded background,
// layered images, and positioned/resized/rotated text boxes), then
// flattening it to a single static PNG uploaded through the existing,
// unmodified media-library upload endpoint. Only ever loaded via
// React.lazy() from MediaManagerPage.tsx - this file (and the fabric/
// @fontsource weight it pulls in) never reaches the public dashboard
// bundle.
//
// The canvas's INTERNAL resolution always stays at the full 1920x1080
// (CANVAS_WIDTH/HEIGHT) - only its on-screen CSS display size is
// shrunk (via setDimensions(..., {cssOnly:true})), so editing renders
// crisp (downscaled from full-res) and export is always a trivial
// multiplier:1 toBlob() call, with no zoom/multiplier interaction to
// get wrong. DISPLAY_WIDTH is deliberately modest (not "as large as
// looks nice") so the controls sidebar is never pushed off-screen on a
// typical browser window - see the modal's flex layout below.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Canvas, Textbox, FabricImage } from 'fabric'
import type { MediaLibraryFile } from '../../types/mediaLibrary'
import type { SlideBackground, SlideFontFamily, SlideImageElement, SlideRecipe, SlideTextBox } from '../../types/slideRecipe'
import { SLIDE_FONT_CSS_STACK, SLIDE_FONT_OPTIONS, ensureSlideFontsLoaded } from './slideFonts'
import {
  MEDIA_LIBRARY_UPLOAD_URL,
  mediaLibraryImageProxyUrl,
  mediaLibraryRecipeUrl,
  mediaLibraryReplaceUrl,
} from '../../config/publicApi'

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080
const DISPLAY_WIDTH = 640
const DISPLAY_HEIGHT = (CANVAS_HEIGHT / CANVAS_WIDTH) * DISPLAY_WIDTH
const NEW_IMAGE_MAX_DIMENSION = 480
const TOAST_DURATION_MS = 3500

type SlideTextboxObject = Textbox & { slideBoxId: string; slideFontKey: SlideFontFamily }
type SlideImageObject = FabricImage & { slideImageId: string; slideImageLibraryId: string }

function isSlideTextbox(obj: unknown): obj is SlideTextboxObject {
  return obj instanceof Textbox
}

// Background images are FabricImage too, but are never selectable
// (see applyBackground below), so checking for the slideImageId tag -
// only ever set on genuine layered image elements - is enough to tell
// them apart without needing a direct reference comparison.
function isSlideImageElement(obj: unknown): obj is SlideImageObject {
  return obj instanceof FabricImage && typeof (obj as { slideImageId?: unknown }).slideImageId === 'string'
}

function defaultBackground(): SlideBackground {
  return { type: 'color', color: '#0a0de1' }
}

function sanitizeSlideName(raw: string): string {
  return raw
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
}

function uniqueSlideFilename(baseName: string, existingFilenames: Set<string>): string {
  const candidate = `${baseName}.png`
  if (!existingFilenames.has(candidate)) return candidate
  let attempt = 2
  while (existingFilenames.has(`${baseName} (${attempt}).png`)) attempt += 1
  return `${baseName} (${attempt}).png`
}

// Shared by "upload new" backgrounds and "+ Add Image" uploads - goes
// through the SAME, unmodified media-library upload endpoint any
// normal photo upload uses, so the result is an ordinary library file
// (subject to the existing quota, reachable via the normal library/
// delete flow afterward) with no special-casing.
async function uploadImageFile(file: File): Promise<MediaLibraryFile> {
  const params = new URLSearchParams({ filename: file.name, mediaType: 'image' })
  const response = await fetch(`${MEDIA_LIBRARY_UPLOAD_URL}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Upload failed')
  return {
    id: data.id,
    filename: data.filename,
    mediaType: 'image',
    sizeBytes: data.sizeBytes,
    mp4DurationSeconds: null,
    uploadedAt: data.uploadedAt,
    url: null,
    slideRecipe: null,
  }
}

function addTextBoxToCanvas(canvas: Canvas, box: SlideTextBox): SlideTextboxObject {
  const obj = new Textbox(box.text, {
    left: box.x,
    top: box.y,
    width: box.width,
    fontFamily: SLIDE_FONT_CSS_STACK[box.fontFamily],
    fontSize: box.fontSize,
    fill: box.color,
    textAlign: box.align,
    fontWeight: box.bold ? 'bold' : 'normal',
    fontStyle: box.italic ? 'italic' : 'normal',
  }) as SlideTextboxObject
  obj.slideBoxId = box.id
  obj.slideFontKey = box.fontFamily
  canvas.add(obj)
  return obj
}

// Loads an existing SlideImageElement (re-edit case) at its saved
// position/size/rotation. Uses the SAME same-origin proxy endpoint as
// the background-image loader (mediaLibraryImageProxyUrl) - the public
// R2 bucket sends no CORS headers, so anything drawn into this canvas
// that later gets flattened via toBlob() MUST be loaded through that
// proxy, never the public pub-*.r2.dev URL directly, or the canvas
// gets tainted and export throws.
async function addImageElementToCanvas(canvas: Canvas, element: SlideImageElement): Promise<SlideImageObject> {
  const img = (await FabricImage.fromURL(mediaLibraryImageProxyUrl(element.mediaLibraryId), {
    crossOrigin: 'anonymous',
  })) as SlideImageObject
  img.slideImageId = element.id
  img.slideImageLibraryId = element.mediaLibraryId
  img.set({
    left: element.x,
    top: element.y,
    angle: element.rotation,
    scaleX: element.width / (img.width || 1),
    scaleY: element.height / (img.height || 1),
  })
  canvas.add(img)
  return img
}

// "Cover" positioning only, per the current scope - no independent
// crop/pan UI for backgrounds in this pass (matches the rest of the
// app's carousel-slot fitMode='fill' behaviour).
async function applyBackground(
  canvas: Canvas,
  background: SlideBackground,
  bgObjectRef: React.MutableRefObject<FabricImage | null>
): Promise<void> {
  if (bgObjectRef.current) {
    canvas.remove(bgObjectRef.current)
    bgObjectRef.current = null
  }

  if (background.type === 'color') {
    canvas.backgroundColor = background.color
    canvas.requestRenderAll()
    return
  }

  canvas.backgroundColor = '#000000'
  const img = await FabricImage.fromURL(mediaLibraryImageProxyUrl(background.mediaLibraryId), { crossOrigin: 'anonymous' })
  const scale = Math.max(CANVAS_WIDTH / (img.width || 1), CANVAS_HEIGHT / (img.height || 1))
  img.set({
    left: CANVAS_WIDTH / 2,
    top: CANVAS_HEIGHT / 2,
    originX: 'center',
    originY: 'center',
    scaleX: scale,
    scaleY: scale,
    selectable: false,
    evented: false,
  })
  canvas.add(img)
  canvas.sendObjectToBack(img)
  bgObjectRef.current = img
  canvas.requestRenderAll()
}

interface TextSelectionProps {
  text: string
  fontFamily: SlideFontFamily
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
  italic: boolean
}

type SelectedState = ({ kind: 'text' } & TextSelectionProps) | { kind: 'image'; id: string }

interface SlideEditorProps {
  files: MediaLibraryFile[]
  // null = creating a brand new slide; non-null = re-editing this
  // existing library file (its slideRecipe, if any, seeds the canvas,
  // and its id is what "Save Slide" updates in place).
  editingFile: MediaLibraryFile | null
  onClose: () => void
  onSaved: () => void
  // Called immediately after any upload that happens WITHIN the editor
  // (a new background, or a new "+ Add Image" source) - refreshes the
  // parent's media library list so the new file is visible there too,
  // independent of whether the slide itself ever gets saved.
  onLibraryChanged: () => void
}

// A brief, non-blocking tip that overlays the modal rather than living
// in document flow - selecting an image has no persistent on-screen
// controls of its own (unlike a text box, which gets a full font/size/
// colour panel), so without this the ONLY way to know drag/resize/
// rotate is even possible was a message that pushed the whole sidebar
// down every time selection changed. Auto-dismisses; the same object
// can still be deleted after it fades via the header row's Delete
// button (always present, just enabled/disabled by selection) or the
// keyboard Delete/Backspace shortcut.
function SelectionToast({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null
  return (
    <div
      className="pointer-events-none absolute right-6 top-20 z-10 max-w-xs rounded-lg border border-accent-sky-500/50 bg-slate-950/95 px-4 py-3 text-sm text-slate-200 shadow-xl"
      role="status"
    >
      {message}
    </div>
  )
}

export default function SlideEditor({ files, editingFile, onClose, onSaved, onLibraryChanged }: SlideEditorProps): JSX.Element {
  const initialRecipe = editingFile?.slideRecipe ?? null
  const editingFileId = editingFile?.id ?? null

  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const bgObjectRef = useRef<FabricImage | null>(null)
  const toastTimerRef = useRef<number | undefined>(undefined)

  const [background, setBackground] = useState<SlideBackground>(initialRecipe?.background ?? defaultBackground())
  const [backgroundMode, setBackgroundMode] = useState<'color' | 'image' | 'upload'>(initialRecipe?.background.type ?? 'color')
  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false)
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null)

  const [addingImage, setAddingImage] = useState(false)
  const [addImageMode, setAddImageMode] = useState<'existing' | 'upload'>('existing')
  const [addImageExistingId, setAddImageExistingId] = useState('')
  const [addImageBusy, setAddImageBusy] = useState(false)
  const [addImageError, setAddImageError] = useState<string | null>(null)

  const [selected, setSelected] = useState<SelectedState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [slideName, setSlideName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Files uploaded during THIS editing session (background or "+ Add
  // Image" uploads) - merged with the files prop so they're usable
  // immediately, without waiting for the parent's next fetch to land.
  const [extraFiles, setExtraFiles] = useState<MediaLibraryFile[]>([])
  const allFiles = useMemo(() => {
    const knownIds = new Set(files.map((f) => f.id))
    return [...files, ...extraFiles.filter((f) => !knownIds.has(f.id))]
  }, [files, extraFiles])
  const imageFiles = useMemo(() => allFiles.filter((f) => f.mediaType === 'image'), [allFiles])

  function showToast(message: string) {
    setToast(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS)
  }

  // Canvas lifecycle - created once on mount, disposed on unmount.
  // Initial images/text boxes are seeded here (not in a separate
  // effect) so they exist before the very first render, avoiding a
  // flash of an empty canvas for the re-edit case. Images load async
  // (FabricImage.fromURL), text boxes are synchronous - images are
  // added first so newly-added text boxes naturally stack on top,
  // matching the "images and text boxes layer in the order added" rule.
  useEffect(() => {
    if (!canvasElRef.current) return
    const canvas = new Canvas(canvasElRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: background.type === 'color' ? background.color : '#000000',
    })
    canvas.setDimensions({ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }, { cssOnly: true })
    fabricRef.current = canvas

    let cancelled = false
    void (async () => {
      for (const element of initialRecipe?.images ?? []) {
        if (cancelled) return
        try {
          await addImageElementToCanvas(canvas, element)
        } catch {
          // A referenced file may have been deleted since this recipe
          // was saved - skip it rather than aborting the whole load.
        }
      }
      if (cancelled) return
      for (const box of initialRecipe?.textBoxes ?? []) {
        addTextBoxToCanvas(canvas, box)
      }
      canvas.requestRenderAll()
    })()

    const syncSelection = () => {
      const obj = canvas.getActiveObject()
      if (isSlideTextbox(obj)) {
        setSelected({
          kind: 'text',
          text: obj.text ?? '',
          fontFamily: obj.slideFontKey,
          fontSize: obj.fontSize ?? 48,
          color: String(obj.fill ?? '#ffffff'),
          align: (obj.textAlign as 'left' | 'center' | 'right') ?? 'left',
          bold: obj.fontWeight === 'bold' || obj.fontWeight === 700,
          italic: obj.fontStyle === 'italic',
        })
      } else if (isSlideImageElement(obj)) {
        setSelected({ kind: 'image', id: obj.slideImageId })
        showToast('Image selected - drag to move, drag a corner to resize, use the top handle to rotate.')
      } else {
        setSelected(null)
        setToast(null)
        window.clearTimeout(toastTimerRef.current)
      }
    }
    canvas.on('selection:created', syncSelection)
    canvas.on('selection:updated', syncSelection)
    canvas.on('selection:cleared', syncSelection)
    canvas.on('text:changed', syncSelection)
    canvas.on('object:modified', syncSelection)

    // Delete/Backspace removes the selected object - but not while
    // actively typing inside a text box (Fabric's own text-editing
    // mode handles Backspace itself; without this guard, deleting a
    // character would delete the whole box instead).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const obj = canvas.getActiveObject()
      if (!obj || (obj as { isEditing?: boolean }).isEditing) return
      canvas.remove(obj)
      canvas.discardActiveObject()
      canvas.requestRenderAll()
      setSelected(null)
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelled = true
      window.clearTimeout(toastTimerRef.current)
      window.removeEventListener('keydown', handleKeyDown)
      canvas.dispose()
      fabricRef.current = null
    }
    // Deliberately empty deps - the canvas is created exactly once;
    // background changes are applied imperatively in the effect below
    // rather than by recreating the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    applyBackground(canvas, background, bgObjectRef)
  }, [background])

  function handleAddTextBox() {
    const canvas = fabricRef.current
    if (!canvas) return
    const box: SlideTextBox = {
      id: crypto.randomUUID(),
      text: 'New text',
      x: CANVAS_WIDTH / 2 - 300,
      y: CANVAS_HEIGHT / 2 - 60,
      width: 600,
      height: 120,
      fontFamily: 'system-sans',
      fontSize: 64,
      color: '#ffffff',
      align: 'center',
    }
    const obj = addTextBoxToCanvas(canvas, box)
    canvas.setActiveObject(obj)
    canvas.requestRenderAll()
    setSelected({
      kind: 'text',
      text: box.text,
      fontFamily: box.fontFamily,
      fontSize: box.fontSize,
      color: box.color,
      align: box.align,
      bold: false,
      italic: false,
    })
  }

  function updateSelectedText(patch: Partial<TextSelectionProps>) {
    const canvas = fabricRef.current
    const obj = canvas?.getActiveObject()
    if (!canvas || !isSlideTextbox(obj)) return

    if (patch.text !== undefined) obj.set('text', patch.text)
    if (patch.fontFamily !== undefined) {
      obj.slideFontKey = patch.fontFamily
      obj.set('fontFamily', SLIDE_FONT_CSS_STACK[patch.fontFamily])
    }
    if (patch.fontSize !== undefined) obj.set('fontSize', patch.fontSize)
    if (patch.color !== undefined) obj.set('fill', patch.color)
    if (patch.align !== undefined) obj.set('textAlign', patch.align)
    if (patch.bold !== undefined) obj.set('fontWeight', patch.bold ? 'bold' : 'normal')
    if (patch.italic !== undefined) obj.set('fontStyle', patch.italic ? 'italic' : 'normal')
    canvas.requestRenderAll()
    setSelected((prev) => (prev && prev.kind === 'text' ? { ...prev, ...patch } : prev))
  }

  function handleDeleteSelected() {
    const canvas = fabricRef.current
    const obj = canvas?.getActiveObject()
    if (!canvas || !obj) return
    canvas.remove(obj)
    canvas.discardActiveObject()
    canvas.requestRenderAll()
    setSelected(null)
    setToast(null)
  }

  // Places a new image element (from either "+ Add Image" flow) centred
  // on the canvas, scaled down to fit within NEW_IMAGE_MAX_DIMENSION on
  // its longer side so it never lands larger than the slide itself.
  async function placeNewImageElement(mediaLibraryId: string) {
    const canvas = fabricRef.current
    if (!canvas) return
    const img = (await FabricImage.fromURL(mediaLibraryImageProxyUrl(mediaLibraryId), {
      crossOrigin: 'anonymous',
    })) as SlideImageObject
    const naturalWidth = img.width || 1
    const naturalHeight = img.height || 1
    const scale = Math.min(1, NEW_IMAGE_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight))
    const width = naturalWidth * scale
    const height = naturalHeight * scale
    const elementId = crypto.randomUUID()
    img.slideImageId = elementId
    img.slideImageLibraryId = mediaLibraryId
    img.set({
      left: CANVAS_WIDTH / 2 - width / 2,
      top: CANVAS_HEIGHT / 2 - height / 2,
      scaleX: scale,
      scaleY: scale,
      angle: 0,
    })
    canvas.add(img)
    canvas.setActiveObject(img)
    canvas.requestRenderAll()
    setSelected({ kind: 'image', id: elementId })
    showToast('Image added - drag to move, drag a corner to resize, use the top handle to rotate.')
    setAddingImage(false)
  }

  function handleAddExistingImage() {
    if (!addImageExistingId) return
    void placeNewImageElement(addImageExistingId)
  }

  async function handleAddImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAddImageBusy(true)
    setAddImageError(null)
    try {
      const uploaded = await uploadImageFile(file)
      setExtraFiles((prev) => [...prev, uploaded])
      onLibraryChanged()
      await placeNewImageElement(uploaded.id)
    } catch (err) {
      setAddImageError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setAddImageBusy(false)
    }
  }

  async function handleBackgroundFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBackgroundUploadBusy(true)
    setBackgroundUploadError(null)
    try {
      const uploaded = await uploadImageFile(file)
      setExtraFiles((prev) => [...prev, uploaded])
      onLibraryChanged()
      setBackground({ type: 'image', mediaLibraryId: uploaded.id })
      setBackgroundMode('image')
    } catch (err) {
      setBackgroundUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBackgroundUploadBusy(false)
    }
  }

  function buildRecipe(): SlideRecipe {
    const canvas = fabricRef.current!
    const images: SlideImageElement[] = canvas
      .getObjects()
      .filter(isSlideImageElement)
      .map((obj) => ({
        id: obj.slideImageId,
        mediaLibraryId: obj.slideImageLibraryId,
        x: Math.round(obj.left ?? 0),
        y: Math.round(obj.top ?? 0),
        width: Math.round((obj.width ?? 0) * (obj.scaleX ?? 1)),
        height: Math.round((obj.height ?? 0) * (obj.scaleY ?? 1)),
        rotation: Math.round(obj.angle ?? 0),
      }))
    const textBoxes: SlideTextBox[] = canvas
      .getObjects()
      .filter(isSlideTextbox)
      .map((obj) => ({
        id: obj.slideBoxId,
        text: obj.text ?? '',
        x: Math.round(obj.left ?? 0),
        y: Math.round(obj.top ?? 0),
        width: Math.round(obj.width ?? 0),
        height: Math.round(obj.height ?? 0),
        fontFamily: obj.slideFontKey,
        fontSize: Math.round(obj.fontSize ?? 48),
        color: String(obj.fill ?? '#ffffff'),
        align: (obj.textAlign as 'left' | 'center' | 'right') ?? 'left',
        bold: obj.fontWeight === 'bold' || obj.fontWeight === 700,
        italic: obj.fontStyle === 'italic',
      }))
    return { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT, background, images, textBoxes }
  }

  // saveAsNew=false is the primary "Save Slide" action: when editing an
  // existing slide, it updates that SAME file in place (PUT .../replace
  // - same id, same r2Key, new bytes, delta-based quota check); when
  // creating a brand new slide (editingFileId is null), there's nothing
  // to update in place, so it falls through to the same "create a new
  // file" path saveAsNew=true always uses. saveAsNew=true ("Save as
  // New", only offered while editing) always creates a fresh file via
  // the unmodified upload endpoint, exactly as every slide save worked
  // before this pass.
  async function performSave(saveAsNew: boolean) {
    const canvas = fabricRef.current
    if (!canvas) return
    setSaving(true)
    setError(null)
    try {
      const recipe = buildRecipe()

      // Deselect first - selection handles/borders must not appear in
      // the exported PNG.
      canvas.discardActiveObject()
      canvas.requestRenderAll()

      // See slideFonts.ts's comment on why this can't just be
      // `await document.fonts.ready` alone.
      await ensureSlideFontsLoaded(recipe)

      const blob = await canvas.toBlob({ format: 'png', multiplier: 1 })
      if (!blob) throw new Error('Could not export the slide as an image')

      const useInPlace = !saveAsNew && editingFileId !== null
      let targetId: string

      if (useInPlace) {
        const replaceResponse = await fetch(mediaLibraryReplaceUrl(editingFileId!), {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: blob,
        })
        const replaced = await replaceResponse.json()
        if (!replaceResponse.ok) throw new Error(replaced.error ?? 'Update failed')
        targetId = editingFileId!
      } else {
        const timestampName = `Slide ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
        const baseName = sanitizeSlideName(slideName) || timestampName
        const existingFilenames = new Set(allFiles.map((f) => f.filename))
        const filename = uniqueSlideFilename(baseName, existingFilenames)

        const uploadResponse = await fetch(
          `${MEDIA_LIBRARY_UPLOAD_URL}?${new URLSearchParams({ filename, mediaType: 'image' })}`,
          { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob }
        )
        const uploaded = await uploadResponse.json()
        if (!uploadResponse.ok) throw new Error(uploaded.error ?? 'Upload failed')
        targetId = uploaded.id
      }

      const recipeResponse = await fetch(mediaLibraryRecipeUrl(targetId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe }),
      })
      // The image itself is already saved (in place or as a new file)
      // and perfectly usable either way - onSaved() (which reloads the
      // library) always runs so it shows up. Only the modal's auto-
      // close is gated on the recipe attach too: if it failed, the
      // user should see why "Edit Slide" won't be available for this
      // one, so the modal stays open with the image already safely
      // saved rather than silently vanishing past a warning they'd
      // never get to read.
      onSaved()
      if (!recipeResponse.ok) {
        setError('Slide image saved, but its editable layout could not be attached - it will still work as a normal photo, but "Edit Slide" won\'t be available for it. Close this dialog whenever you\'re ready.')
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving the slide')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold uppercase tracking-wide text-primary">
            {editingFile ? 'Edit Slide' : 'Create Slide'}
          </h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-muted-400 hover:text-status-bad">
            ✕ Close
          </button>
        </div>

        <SelectionToast message={toast} />

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 md:flex-row">
          {/* Canvas - fixed, deliberately modest display size so the
              sidebar to its right is always visible without scrolling
              the modal on a typical browser window. */}
          <div className="flex flex-shrink-0 flex-col items-center gap-2">
            <div
              className="overflow-hidden rounded-lg border border-border shadow-lg"
              style={{ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }}
            >
              <canvas ref={canvasElRef} />
            </div>
            <p className="max-w-[640px] text-xs text-muted-500">
              Double-click a text box to edit its wording directly on the canvas. Drag any element to move it, its
              corners to resize, its top handle to rotate.
            </p>
          </div>

          {/* Controls */}
          <div className="flex min-w-[280px] flex-1 flex-col gap-5">
            {/* Background */}
            <section>
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-accent-sky-400">Background</div>
              <div className="mb-2 flex flex-wrap gap-4">
                <label className="flex items-center gap-1.5 text-sm text-muted-300">
                  <input
                    type="radio"
                    checked={backgroundMode === 'color'}
                    onChange={() => {
                      setBackgroundMode('color')
                      if (background.type !== 'color') setBackground(defaultBackground())
                    }}
                  />
                  Solid colour
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-300">
                  <input
                    type="radio"
                    checked={backgroundMode === 'image'}
                    onChange={() => {
                      setBackgroundMode('image')
                      if (background.type !== 'image') setBackground({ type: 'image', mediaLibraryId: imageFiles[0]?.id ?? '' })
                    }}
                    disabled={imageFiles.length === 0}
                  />
                  Existing image
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-300">
                  <input type="radio" checked={backgroundMode === 'upload'} onChange={() => setBackgroundMode('upload')} />
                  Upload new image
                </label>
              </div>

              {backgroundMode === 'color' && background.type === 'color' && (
                <input
                  type="color"
                  value={background.color}
                  onChange={(event) => setBackground({ type: 'color', color: event.target.value })}
                  className="h-9 w-20 cursor-pointer rounded border border-slate-700 bg-slate-900/80"
                />
              )}
              {backgroundMode === 'image' && background.type === 'image' && (
                <select
                  value={background.mediaLibraryId}
                  onChange={(event) => setBackground({ type: 'image', mediaLibraryId: event.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                >
                  {imageFiles.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.filename}
                    </option>
                  ))}
                </select>
              )}
              {backgroundMode === 'upload' && (
                <div className="flex flex-col gap-1.5">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBackgroundFileChange}
                    disabled={backgroundUploadBusy}
                    className="text-sm text-muted-300"
                  />
                  {backgroundUploadBusy && <p className="text-xs text-muted-400">Uploading…</p>}
                  {backgroundUploadError && <p className="text-xs font-semibold text-status-bad">{backgroundUploadError}</p>}
                </div>
              )}
            </section>

            {/* Images - header row (Add/Delete) is a fixed height
                regardless of state; the content area below has a
                reserved min-height so opening the "+ Add Image" form
                doesn't shift anything else in the sidebar or resize
                the modal. The old inline "Image selected" message is
                gone entirely - replaced by the SelectionToast above. */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-widest text-accent-sky-400">Images</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={selected?.kind !== 'image'}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-status-bad hover:border-status-bad disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingImage((prev) => !prev)}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500"
                  >
                    + Add Image
                  </button>
                </div>
              </div>

              <div className="min-h-[104px]">
                {addingImage ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-dashed border-slate-700 p-3">
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-1.5 text-sm text-muted-300">
                        <input
                          type="radio"
                          checked={addImageMode === 'existing'}
                          onChange={() => setAddImageMode('existing')}
                          disabled={imageFiles.length === 0}
                        />
                        Existing image
                      </label>
                      <label className="flex items-center gap-1.5 text-sm text-muted-300">
                        <input type="radio" checked={addImageMode === 'upload'} onChange={() => setAddImageMode('upload')} />
                        Upload new
                      </label>
                    </div>
                    {addImageMode === 'existing' ? (
                      <div className="flex gap-2">
                        <select
                          value={addImageExistingId}
                          onChange={(event) => setAddImageExistingId(event.target.value)}
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                        >
                          <option value="">— choose an image —</option>
                          {imageFiles.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.filename}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={handleAddExistingImage}
                          disabled={!addImageExistingId}
                          className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500 disabled:opacity-50"
                        >
                          Add to Canvas
                        </button>
                      </div>
                    ) : (
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAddImageFileChange}
                        disabled={addImageBusy}
                        className="text-sm text-muted-300"
                      />
                    )}
                    {addImageBusy && <p className="text-xs text-muted-400">Uploading…</p>}
                    {addImageError && <p className="text-xs font-semibold text-status-bad">{addImageError}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-500">
                    Click "+ Add Image" to place a photo on the slide (e.g. a headshot over the background).
                  </p>
                )}
              </div>
            </section>

            {/* Text boxes - same fixed-header/reserved-height treatment
                as Images above. The full font/size/colour/align panel
                stays inline (unlike the image case, it holds controls
                the user needs to keep interacting with, so it can't be
                a transient toast) - the min-height on its container is
                what stops it from resizing the modal on selection. */}
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-widest text-accent-sky-400">Text Boxes</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    disabled={selected?.kind !== 'text'}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-status-bad hover:border-status-bad disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={handleAddTextBox}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500"
                  >
                    + Add Text Box
                  </button>
                </div>
              </div>

              <div className="min-h-[310px]">
                {selected?.kind === 'text' ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-dashed border-accent-sky-500/40 bg-slate-950/40 p-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Text</span>
                      <textarea
                        value={selected.text}
                        onChange={(event) => updateSelectedText({ text: event.target.value })}
                        rows={2}
                        className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Font</span>
                      <select
                        value={selected.fontFamily}
                        onChange={(event) => updateSelectedText({ fontFamily: event.target.value as SlideFontFamily })}
                        className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                      >
                        {SLIDE_FONT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Size (px)</span>
                        <input
                          type="number"
                          min={8}
                          max={300}
                          value={selected.fontSize}
                          onChange={(event) => updateSelectedText({ fontSize: Number(event.target.value) || 48 })}
                          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Colour</span>
                        <input
                          type="color"
                          value={selected.color}
                          onChange={(event) => updateSelectedText({ color: event.target.value })}
                          className="h-9 w-full cursor-pointer rounded border border-slate-700 bg-slate-900/80"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          type="button"
                          onClick={() => updateSelectedText({ align })}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest ${
                            selected.align === align
                              ? 'border-sky-500 bg-sky-500/20 text-accent-sky-400'
                              : 'border-slate-700 bg-slate-900/40 text-muted-400'
                          }`}
                        >
                          {align}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateSelectedText({ bold: !selected.bold })}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                          selected.bold
                            ? 'border-sky-500 bg-sky-500/20 text-accent-sky-400'
                            : 'border-slate-700 bg-slate-900/40 text-muted-400'
                        }`}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSelectedText({ italic: !selected.italic })}
                        className={`rounded-lg border px-3 py-1.5 text-xs italic uppercase tracking-widest ${
                          selected.italic
                            ? 'border-sky-500 bg-sky-500/20 text-accent-sky-400'
                            : 'border-slate-700 bg-slate-900/40 text-muted-400'
                        }`}
                      >
                        I
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-500">
                    Click "+ Add Text Box", or select an existing one on the canvas, to edit its font/size/colour/
                    alignment here.
                  </p>
                )}
              </div>
            </section>

            {error && <p className="text-sm font-semibold text-status-bad">{error}</p>}

            <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Slide name</span>
                <input
                  type="text"
                  value={slideName}
                  onChange={(event) => setSlideName(event.target.value)}
                  placeholder="e.g. Trial Flights Promo"
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
                {editingFileId && (
                  <span className="text-xs text-muted-500">
                    Only used by "Save as New" below - "Save Slide" updates "{editingFile?.filename}" in place.
                  </span>
                )}
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => performSave(false)}
                  disabled={saving}
                  className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Slide'}
                </button>
                {editingFileId && (
                  <button
                    type="button"
                    onClick={() => performSave(true)}
                    disabled={saving}
                    className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-2 text-sm font-semibold text-accent-sky-400 hover:border-sky-500 disabled:opacity-50"
                  >
                    Save as New
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-2 text-sm font-semibold text-muted-400 hover:border-sky-500 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
