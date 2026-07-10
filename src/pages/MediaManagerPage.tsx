import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import type { CarouselSlot, MediaLibraryFile } from '../types/mediaLibrary'
import { CAROUSEL_SLOTS_URL, MEDIA_LIBRARY_UPLOAD_URL, MEDIA_LIBRARY_URL, PUBLIC_CONFIG_URL } from '../config/publicApi'

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

  async function saveSlot(updated: CarouselSlot) {
    setSlots((prev) => prev.map((s) => (s.slotNumber === updated.slotNumber ? updated : s)))
    await fetch(CAROUSEL_SLOTS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots: [updated] }),
    })
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

  const assignedFile = (slot: CarouselSlot) => files.find((f) => f.id === slot.mediaLibraryId)

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-4xl px-5 pb-16 pt-8">
        <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
          ← Back to Config
        </Link>
        <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">Media Manager</h1>
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

              <label className="mb-4 inline-block cursor-pointer rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400">
                {uploading ? 'Uploading…' : '+ Upload file'}
                <input
                  type="file"
                  accept="image/*,video/mp4,application/pdf"
                  onChange={handleUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
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
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(file)}
                        className="text-xs font-semibold text-status-bad"
                      >
                        Delete
                      </button>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {slots.map((slot) => {
                  const file = assignedFile(slot)
                  const isMp4 = slot.mediaType === 'mp4'
                  return (
                    <div key={slot.slotNumber} className="rounded-xl border border-border bg-card p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-400">
                          Slot {slot.slotNumber}
                        </span>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={slot.enabled}
                            onChange={(event) => saveSlot({ ...slot, enabled: event.target.checked })}
                            className="h-4 w-4"
                          />
                          <span className="text-xs text-muted-300">Enabled</span>
                        </label>
                      </div>

                      <label className="mb-3 flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Source</span>
                        <select
                          value={sourceValueFor(slot)}
                          onChange={(event) => handleSourceChange(slot, event.target.value)}
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
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                          Duration (seconds)
                        </span>
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
                            onChange={(event) => saveSlot({ ...slot, durationSeconds: Number(event.target.value) || 10 })}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                          />
                        )}
                      </label>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
