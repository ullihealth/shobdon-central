// The slide composer: a Fabric.js canvas editor for building a custom
// slide (solid-colour or existing-image background + positioned/
// resized/rotated text boxes), then flattening it to a single static
// PNG uploaded through the existing, unmodified media-library upload
// endpoint. Only ever loaded via React.lazy() from MediaManagerPage.tsx -
// this file (and the fabric/@fontsource weight it pulls in) never
// reaches the public dashboard bundle.
//
// The canvas's INTERNAL resolution always stays at the full 1920x1080
// (CANVAS_WIDTH/HEIGHT) - only its on-screen CSS display size is
// shrunk (via setDimensions(..., {cssOnly:true})), so editing renders
// crisp (downscaled from full-res) and export is always a trivial
// multiplier:1 toBlob() call, with no zoom/multiplier interaction to
// get wrong.
import { useEffect, useRef, useState } from 'react'
import { Canvas, Textbox, FabricImage } from 'fabric'
import type { MediaLibraryFile } from '../../types/mediaLibrary'
import type { SlideBackground, SlideFontFamily, SlideRecipe, SlideTextBox } from '../../types/slideRecipe'
import { SLIDE_FONT_CSS_STACK, SLIDE_FONT_OPTIONS, ensureSlideFontsLoaded } from './slideFonts'
import { MEDIA_LIBRARY_UPLOAD_URL, mediaLibraryImageProxyUrl, mediaLibraryRecipeUrl } from '../../config/publicApi'

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080
const DISPLAY_WIDTH = 860
const DISPLAY_HEIGHT = (CANVAS_HEIGHT / CANVAS_WIDTH) * DISPLAY_WIDTH

type SlideTextboxObject = Textbox & { slideBoxId: string; slideFontKey: SlideFontFamily }

function isSlideTextbox(obj: unknown): obj is SlideTextboxObject {
  return obj instanceof Textbox
}

function defaultBackground(): SlideBackground {
  return { type: 'color', color: '#0a0de1' }
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

// "Cover" positioning only, per the current scope - no independent
// crop/pan UI for backgrounds in this pass (matches the rest of the
// app's carousel-slot fitMode='fill' behaviour).
async function applyBackground(
  canvas: Canvas,
  background: SlideBackground,
  bgObjectRef: React.MutableRefObject<FabricImage | null>,
  files: MediaLibraryFile[]
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

  const file = files.find((f) => f.id === background.mediaLibraryId)
  if (!file) {
    canvas.backgroundColor = '#000000'
    canvas.requestRenderAll()
    return
  }

  canvas.backgroundColor = '#000000'
  const img = await FabricImage.fromURL(mediaLibraryImageProxyUrl(file.id), { crossOrigin: 'anonymous' })
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

interface SelectedProps {
  text: string
  fontFamily: SlideFontFamily
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
  italic: boolean
}

interface SlideEditorProps {
  files: MediaLibraryFile[]
  initialRecipe: SlideRecipe | null
  onClose: () => void
  onSaved: () => void
}

export default function SlideEditor({ files, initialRecipe, onClose, onSaved }: SlideEditorProps): JSX.Element {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const bgObjectRef = useRef<FabricImage | null>(null)

  const [background, setBackground] = useState<SlideBackground>(initialRecipe?.background ?? defaultBackground())
  const [selected, setSelected] = useState<SelectedProps | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const imageFiles = files.filter((f) => f.mediaType === 'image')

  // Canvas lifecycle - created once on mount, disposed on unmount.
  // Initial text boxes are seeded here (not in a separate effect) so
  // they exist before the very first render, avoiding a flash of an
  // empty canvas for the re-edit case.
  useEffect(() => {
    if (!canvasElRef.current) return
    const canvas = new Canvas(canvasElRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: background.type === 'color' ? background.color : '#000000',
    })
    canvas.setDimensions({ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }, { cssOnly: true })
    fabricRef.current = canvas

    for (const box of initialRecipe?.textBoxes ?? []) {
      addTextBoxToCanvas(canvas, box)
    }
    canvas.requestRenderAll()

    const syncSelection = () => {
      const obj = canvas.getActiveObject()
      if (isSlideTextbox(obj)) {
        setSelected({
          text: obj.text ?? '',
          fontFamily: obj.slideFontKey,
          fontSize: obj.fontSize ?? 48,
          color: String(obj.fill ?? '#ffffff'),
          align: (obj.textAlign as 'left' | 'center' | 'right') ?? 'left',
          bold: obj.fontWeight === 'bold' || obj.fontWeight === 700,
          italic: obj.fontStyle === 'italic',
        })
      } else {
        setSelected(null)
      }
    }
    canvas.on('selection:created', syncSelection)
    canvas.on('selection:updated', syncSelection)
    canvas.on('selection:cleared', syncSelection)
    canvas.on('text:changed', syncSelection)
    canvas.on('object:modified', syncSelection)

    // Delete/Backspace removes the selected text box - but not while
    // actively typing inside one (Fabric's own text-editing mode
    // handles Backspace itself; without this guard, deleting a
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
      window.removeEventListener('keydown', handleKeyDown)
      canvas.dispose()
      fabricRef.current = null
    }
    // Deliberately empty deps - the canvas is created exactly once;
    // background/file changes are applied imperatively in the effect
    // below rather than by recreating the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    applyBackground(canvas, background, bgObjectRef, files)
  }, [background, files])

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
      text: box.text,
      fontFamily: box.fontFamily,
      fontSize: box.fontSize,
      color: box.color,
      align: box.align,
      bold: false,
      italic: false,
    })
  }

  function updateSelected(patch: Partial<SelectedProps>) {
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
    setSelected((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function handleDeleteSelected() {
    const canvas = fabricRef.current
    const obj = canvas?.getActiveObject()
    if (!canvas || !obj) return
    canvas.remove(obj)
    canvas.discardActiveObject()
    canvas.requestRenderAll()
    setSelected(null)
  }

  function buildRecipe(): SlideRecipe {
    const canvas = fabricRef.current!
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
    return { canvasWidth: CANVAS_WIDTH, canvasHeight: CANVAS_HEIGHT, background, textBoxes }
  }

  async function handleSave() {
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

      const filename = `Slide ${new Date().toISOString().slice(0, 19).replace('T', ' ')}.png`
      const uploadResponse = await fetch(
        `${MEDIA_LIBRARY_UPLOAD_URL}?${new URLSearchParams({ filename, mediaType: 'image' })}`,
        { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob }
      )
      const uploaded = await uploadResponse.json()
      if (!uploadResponse.ok) throw new Error(uploaded.error ?? 'Upload failed')

      const recipeResponse = await fetch(mediaLibraryRecipeUrl(uploaded.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe }),
      })
      // The image itself is already uploaded and perfectly usable either
      // way - onSaved() (which reloads the library) always runs so it
      // shows up. Only the modal's auto-close is gated on the recipe
      // attach too: if it failed, the user should see why "Edit Slide"
      // won't be available for this one, so the modal stays open with
      // the image already safely saved rather than silently vanishing
      // past a warning they'd never get to read.
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
      <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold uppercase tracking-wide text-primary">
            {initialRecipe ? 'Edit Slide' : 'Create Slide'}
          </h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-muted-400 hover:text-status-bad">
            ✕ Close
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 md:flex-row">
          {/* Canvas */}
          <div className="flex flex-shrink-0 flex-col items-center gap-2">
            <div
              className="overflow-hidden rounded-lg border border-border shadow-lg"
              style={{ width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }}
            >
              <canvas ref={canvasElRef} />
            </div>
            <p className="text-xs text-muted-500">Double-click a text box to edit its wording directly on the canvas.</p>
          </div>

          {/* Controls */}
          <div className="flex min-w-[280px] flex-1 flex-col gap-5">
            {/* Background */}
            <section>
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-accent-sky-400">Background</div>
              <div className="mb-2 flex gap-4">
                <label className="flex items-center gap-1.5 text-sm text-muted-300">
                  <input
                    type="radio"
                    checked={background.type === 'color'}
                    onChange={() => setBackground(defaultBackground())}
                  />
                  Solid colour
                </label>
                <label className="flex items-center gap-1.5 text-sm text-muted-300">
                  <input
                    type="radio"
                    checked={background.type === 'image'}
                    onChange={() =>
                      setBackground({ type: 'image', mediaLibraryId: imageFiles[0]?.id ?? '' })
                    }
                    disabled={imageFiles.length === 0}
                  />
                  Existing image
                </label>
              </div>
              {background.type === 'color' ? (
                <input
                  type="color"
                  value={background.color}
                  onChange={(event) => setBackground({ type: 'color', color: event.target.value })}
                  className="h-9 w-20 cursor-pointer rounded border border-slate-700 bg-slate-900/80"
                />
              ) : (
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
            </section>

            {/* Text boxes */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-widest text-accent-sky-400">Text Boxes</div>
                <button
                  type="button"
                  onClick={handleAddTextBox}
                  className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500"
                >
                  + Add Text Box
                </button>
              </div>

              {selected ? (
                <div className="flex flex-col gap-3 rounded-xl border border-dashed border-accent-sky-500/40 bg-slate-950/40 p-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Text</span>
                    <textarea
                      value={selected.text}
                      onChange={(event) => updateSelected({ text: event.target.value })}
                      rows={2}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Font</span>
                    <select
                      value={selected.fontFamily}
                      onChange={(event) => updateSelected({ fontFamily: event.target.value as SlideFontFamily })}
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
                        onChange={(event) => updateSelected({ fontSize: Number(event.target.value) || 48 })}
                        className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Colour</span>
                      <input
                        type="color"
                        value={selected.color}
                        onChange={(event) => updateSelected({ color: event.target.value })}
                        className="h-9 w-full cursor-pointer rounded border border-slate-700 bg-slate-900/80"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        type="button"
                        onClick={() => updateSelected({ align })}
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
                      onClick={() => updateSelected({ bold: !selected.bold })}
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
                      onClick={() => updateSelected({ italic: !selected.italic })}
                      className={`rounded-lg border px-3 py-1.5 text-xs italic uppercase tracking-widest ${
                        selected.italic
                          ? 'border-sky-500 bg-sky-500/20 text-accent-sky-400'
                          : 'border-slate-700 bg-slate-900/40 text-muted-400'
                      }`}
                    >
                      I
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="self-start text-xs font-semibold text-status-bad"
                  >
                    Delete this text box
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-500">
                  Click "+ Add Text Box", or select an existing one on the canvas, to edit its font/size/colour/
                  alignment here. Drag its corners to resize, drag its edges to rotate.
                </p>
              )}
            </section>

            {error && <p className="text-sm font-semibold text-status-bad">{error}</p>}

            <div className="mt-auto flex gap-3 border-t border-border pt-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Slide'}
              </button>
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
  )
}
