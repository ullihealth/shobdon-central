import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { MediaFolder, MediaLibraryFile } from '../types/mediaLibrary'
import { MEDIA_FOLDERS_URL, MEDIA_LIBRARY_UPLOAD_URL, MEDIA_LIBRARY_URL, mediaLibraryImageProxyUrl } from '../config/publicApi'

// Dynamic import - keeps fabric.js and the self-hosted slide fonts
// (~90KB+ gzipped combined) out of every bundle except the one fetched
// when a Media Library user actually clicks "Create Slide"/"Edit
// Slide". Unchanged from its previous home in MediaManagerPage.tsx.
const SlideEditor = lazy(() => import('../components/media/SlideEditor'))

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

// Shared Mac-Finder-style click-to-edit behaviour: click to start, Enter
// or blur (clicking away) saves, Escape cancels and reverts with no
// save. Used by both the media library's filename rename and the folder
// sidebar's rename, so both share the exact same save/cancel keys and
// empty-name handling rather than two subtly different implementations.
//
// A React hook, not a plain function - components using it (FilenameWith-
// HoverPreview, FolderRow) call it exactly once per own render, which is
// what makes it legal; it must never be called conditionally or inside a
// loop/.map() callback directly (that would call useState/useRef a
// varying number of times across renders and break React's hook order).
//
// settledRef guards against a save AND a cancel both firing for the same
// edit - e.g. Escape unmounting the input can also trigger a native blur
// event in some browsers. Whichever handler runs first "settles" the
// edit; the other becomes a no-op instead of double-submitting or
// reverting a value that was already saved.
function useInlineEdit(value: string, onSave: (next: string) => void) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function startEditing() {
    settledRef.current = false
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    if (settledRef.current) return
    settledRef.current = true
    setEditing(false)
    const trimmed = draft.trim()
    // Empty/whitespace-only input: reject and revert, no save - matches
    // Finder's own behaviour rather than saving a blank name.
    if (trimmed && trimmed !== value) onSave(trimmed)
  }

  function cancel() {
    if (settledRef.current) return
    settledRef.current = true
    setEditing(false)
    setDraft(value)
  }

  return { editing, draft, setDraft, inputRef, startEditing, commit, cancel }
}

// Hovering a filename shows a larger real thumbnail in a floating card -
// reuses the SAME same-origin image-proxy endpoint the slide composer
// already relies on for CORS-safe canvas loading (mediaLibraryImageProxyUrl,
// GET /api/tenant/media-library/:id/image), not a new mechanism. PDFs
// show a plain glyph with no fetch at all, same as the inline thumbnail.
//
// The <img>/<video> is only mounted while actually hovering (plain
// onMouseEnter/Leave state), NOT always-rendered-but-CSS-hidden via
// group-hover - a CSS-only hidden approach still fetches every visible
// row's proxy image on initial render regardless of whether it's ever
// hovered, which defeats the point of an on-demand preview and floods
// the network tab (and, for any file whose R2 object doesn't resolve,
// the console) for a library that's just sitting there being scrolled
// past. Mounting on demand means the request only fires on a real hover.
//
// Positioned via plain absolute (no portal, no new dependency) - safe
// as long as no ancestor sets overflow-hidden, which this page's
// containers deliberately don't.
//
// Also doubles as the click-to-rename target (Mac Finder style, via
// useInlineEdit above) - the two features are independent by
// construction: hover state lives on the OUTER wrapping span and is
// driven purely by mouseEnter/mouseLeave on that span, regardless of
// whether its child is currently the plain filename span or the rename
// <input>, so entering/leaving edit mode never touches hover state or
// vice versa. The preview is suppressed while actively editing purely
// as a small polish (no point floating a thumbnail over an open text
// field), not because the two would otherwise conflict.
function FilenameWithHoverPreview({
  file,
  onRename,
}: {
  file: MediaLibraryFile
  onRename: (newFilename: string) => void
}): JSX.Element {
  const [hovering, setHovering] = useState(false)
  const edit = useInlineEdit(file.filename, onRename)

  return (
    <span className="relative inline-block" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
      {edit.editing ? (
        <input
          ref={edit.inputRef}
          type="text"
          value={edit.draft}
          onChange={(event) => edit.setDraft(event.target.value)}
          onBlur={edit.commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              edit.commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              edit.cancel()
            }
          }}
          aria-label={`Rename ${file.filename}`}
          className="rounded border border-accent-sky-500/60 bg-slate-900/80 px-1.5 py-0.5 text-sm font-semibold text-white focus:outline-none"
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          onClick={edit.startEditing}
          onKeyDown={(event) => {
            if (event.key === 'Enter') edit.startEditing()
          }}
          title="Click to rename"
          className="cursor-text text-sm font-semibold text-white decoration-dotted hover:underline"
        >
          {file.filename}
        </span>
      )}
      {hovering && !edit.editing && (
        <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-border bg-slate-950 p-2 shadow-xl shadow-slate-950/50">
          {file.mediaType === 'image' && (
            <img src={mediaLibraryImageProxyUrl(file.id)} alt="" className="h-40 w-full rounded bg-slate-900 object-contain" />
          )}
          {file.mediaType === 'mp4' && (
            <video
              src={mediaLibraryImageProxyUrl(file.id)}
              muted
              preload="metadata"
              className="h-40 w-full rounded bg-slate-900 object-contain"
            />
          )}
          {file.mediaType === 'pdf' && (
            <span className="flex h-40 w-full items-center justify-center rounded bg-slate-900 text-6xl">📄</span>
          )}
        </span>
      )}
    </span>
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

// Auto-detects orientation from the file's actual pixel dimensions where
// possible - image via a plain Image() load, mp4 via a <video> element's
// loadedmetadata event (same technique, and same off-DOM approach, as
// probeMp4Duration above). Landscape/square buckets to '16:9', portrait
// to '9:16' - the schema only has 3 buckets (see migration 0037's own
// comment), not a continuous ratio, so this is a genuine mapping, not an
// approximation of one. pdf has no reliable client-side dimension read
// and is left at the upload endpoint's own '16:9' fallback default.
// Resolves null on any load failure so a broken/corrupt file never
// blocks the upload itself - same null-on-error posture as
// probeMp4Duration.
function detectOrientation(file: File, mediaType: 'image' | 'mp4' | 'pdf'): Promise<'16:9' | '9:16' | null> {
  if (mediaType === 'image') {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(img.src)
        resolve(img.naturalWidth >= img.naturalHeight ? '16:9' : '9:16')
      }
      img.onerror = () => {
        URL.revokeObjectURL(img.src)
        resolve(null)
      }
      img.src = URL.createObjectURL(file)
    })
  }
  if (mediaType === 'mp4') {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src)
        resolve(video.videoWidth >= video.videoHeight ? '16:9' : '9:16')
      }
      video.onerror = () => {
        URL.revokeObjectURL(video.src)
        resolve(null)
      }
      video.src = URL.createObjectURL(file)
    })
  }
  return Promise.resolve(null)
}

function mediaTypeFromFile(file: File): 'image' | 'mp4' | 'pdf' | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'video/mp4') return 'mp4'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

function folderRowClass(selected: boolean): string {
  return `flex cursor-pointer items-center justify-between gap-5 rounded-lg border py-2 pl-3 pr-4 text-sm transition ${
    selected
      ? 'border-accent-sky-500 bg-accent-sky-500/10 font-semibold text-white'
      : 'border-transparent text-muted-300 hover:bg-slate-800/60'
  }`
}

// One folder row - a real component (not inline JSX in FolderSidebar's
// .map()) specifically so useInlineEdit can be called once per row
// instance; calling a hook directly inside a .map() callback body would
// violate React's rules of hooks (a varying number of hook calls across
// renders as folders are added/removed).
//
// Click behaviour matches standard file-manager convention: a single
// click on an unselected folder's name selects it (same as clicking
// anywhere else in the row); a click on a folder name that's ALREADY
// selected enters rename instead.
function FolderRow({
  folder,
  selected,
  onSelect,
  onRename,
  onDelete,
}: {
  folder: MediaFolder
  selected: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
}): JSX.Element {
  const edit = useInlineEdit(folder.name, onRename)

  function handleNameClick(event: ReactMouseEvent | ReactKeyboardEvent) {
    event.stopPropagation()
    if (selected) {
      edit.startEditing()
    } else {
      onSelect()
    }
  }

  return (
    <div className={`group ${folderRowClass(selected)}`} onClick={onSelect}>
      {edit.editing ? (
        <input
          ref={edit.inputRef}
          type="text"
          value={edit.draft}
          onChange={(event) => edit.setDraft(event.target.value)}
          onBlur={edit.commit}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              edit.commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              edit.cancel()
            }
          }}
          aria-label={`Rename ${folder.name}`}
          className="min-w-0 flex-1 rounded border border-accent-sky-500/60 bg-slate-900/80 px-1.5 py-0.5 text-sm text-white focus:outline-none"
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          onClick={handleNameClick}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleNameClick(event)
          }}
          title={selected ? 'Click to rename' : undefined}
          className={`min-w-0 flex-1 truncate ${selected ? 'cursor-text decoration-dotted hover:underline' : 'cursor-pointer'}`}
        >
          {folder.name}
        </span>
      )}
      <span className="flex flex-shrink-0 items-center gap-3">
        <span className="text-xs text-muted-500">{folder.fileCount}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-lg font-bold leading-none text-muted-500 opacity-0 hover:bg-slate-800 hover:text-status-bad group-hover:opacity-100"
          aria-label={`Delete ${folder.name}`}
        >
          ×
        </button>
      </span>
    </div>
  )
}

// Lightweight, flat (no nesting) folder list WITHIN this page - distinct
// from the app's main admin sidebar. "All files" and "Uncategorized" are
// always present and not deletable/renamable - "Uncategorized" is
// virtual (folderId IS NULL on media_library), it never has a real
// media_folders row. Folder-creation is a small local text input rather
// than window.prompt().
function FolderSidebar({
  folders,
  totalFileCount,
  uncategorizedCount,
  selectedFolderId,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  folders: MediaFolder[]
  totalFileCount: number
  uncategorizedCount: number
  selectedFolderId: string | null | 'all'
  onSelect: (id: string | null | 'all') => void
  onCreateFolder: (name: string) => void
  onRenameFolder: (folder: MediaFolder, name: string) => void
  onDeleteFolder: (folder: MediaFolder) => void
}): JSX.Element {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  function submitNewFolder() {
    const trimmed = newName.trim()
    if (!trimmed) return
    onCreateFolder(trimmed)
    setNewName('')
    setCreating(false)
  }

  function cancelNewFolder() {
    setNewName('')
    setCreating(false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={folderRowClass(selectedFolderId === 'all')} onClick={() => onSelect('all')}>
        <span className="truncate">All files</span>
        <span className="flex-shrink-0 text-xs text-muted-500">{totalFileCount}</span>
      </div>
      <div className={folderRowClass(selectedFolderId === null)} onClick={() => onSelect(null)}>
        <span className="truncate">Uncategorized</span>
        <span className="flex-shrink-0 text-xs text-muted-500">{uncategorizedCount}</span>
      </div>

      {folders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          selected={selectedFolderId === folder.id}
          onSelect={() => onSelect(folder.id)}
          onRename={(name) => onRenameFolder(folder, name)}
          onDelete={() => onDeleteFolder(folder)}
        />
      ))}

      {creating ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-accent-sky-500/60 bg-slate-900/40 px-2 py-1.5">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitNewFolder()
              if (event.key === 'Escape') cancelNewFolder()
            }}
            placeholder="Folder name"
            aria-label="New folder name"
            className="min-w-0 flex-1 bg-transparent text-sm text-white focus:outline-none"
          />
          <button type="button" onClick={submitNewFolder} className="text-xs font-semibold text-accent-sky-400">
            Add
          </button>
          <button type="button" onClick={cancelNewFolder} className="text-xs text-muted-500">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500"
        >
          + New folder
        </button>
      )}
    </div>
  )
}

export default function MediaLibraryPage(): JSX.Element {
  const [files, setFiles] = useState<MediaLibraryFile[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [capBytes, setCapBytes] = useState(100 * 1024 * 1024)
  const [folders, setFolders] = useState<MediaFolder[]>([])
  // 'all' = every file regardless of folder (the default view);
  // null = the virtual "Uncategorized" bucket; otherwise a real
  // media_folders id.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // null = closed; a MediaLibraryFile (with a recipe) = re-editing that
  // slide; an empty-shell value would be wrong here - "create new" is
  // represented by the boolean below instead, since there's no existing
  // file/recipe to point at yet.
  const [editingSlideFile, setEditingSlideFile] = useState<MediaLibraryFile | null>(null)
  const [creatingSlide, setCreatingSlide] = useState(false)

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

  function loadFolders() {
    return fetch(MEDIA_FOLDERS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setFolders(data?.folders ?? []))
  }

  useEffect(() => {
    Promise.all([loadLibrary(), loadFolders()]).finally(() => setLoading(false))
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

    const [mp4DurationSeconds, orientation] = await Promise.all([
      mediaType === 'mp4' ? probeMp4Duration(file) : Promise.resolve(null),
      detectOrientation(file, mediaType),
    ])

    const params = new URLSearchParams({ filename: file.name, mediaType })
    if (mp4DurationSeconds !== null) params.set('mp4DurationSeconds', String(mp4DurationSeconds))
    if (orientation) params.set('orientation', orientation)
    // Drop the upload straight into whichever real folder is currently
    // selected - 'all' and the virtual Uncategorized (null) both mean
    // "no folder", exactly the upload endpoint's default.
    if (selectedFolderId && selectedFolderId !== 'all') params.set('folderId', selectedFolderId)

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

  // Metadata-only move, same shape as a carousel slot source change -
  // no R2 object is touched, just media_library.folderId.
  async function handleMoveFile(file: MediaLibraryFile, folderId: string | null) {
    await fetch(`${MEDIA_LIBRARY_URL}/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    })
    await Promise.all([loadLibrary(), loadFolders()])
  }

  // Retags usableOn/orientation (migration 0037) - same metadata-only
  // PATCH pattern as handleMoveFile above, just a different field.
  async function handleRetagFile(file: MediaLibraryFile, patch: { usableOn?: MediaLibraryFile['usableOn']; orientation?: MediaLibraryFile['orientation'] }) {
    await fetch(`${MEDIA_LIBRARY_URL}/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await loadLibrary()
  }

  function handleCreateFolder(name: string) {
    fetch(MEDIA_FOLDERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(() => loadFolders())
  }

  // Empty-name rejection and "unchanged, don't bother saving" are both
  // already handled inside useInlineEdit before onRename ever fires -
  // this only needs to do the actual write.
  function handleRenameFolder(folder: MediaFolder, name: string) {
    fetch(`${MEDIA_FOLDERS_URL}/${folder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then(() => loadFolders())
  }

  // Display-name-only rename - the PATCH handler never touches r2Key or
  // the file's id, so this can't affect its public URL or any carousel
  // slot currently assigned to it (those reference mediaLibraryId, never
  // filename).
  function handleRenameFile(file: MediaLibraryFile, filename: string) {
    fetch(`${MEDIA_LIBRARY_URL}/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    }).then(() => loadLibrary())
  }

  // Files inside a deleted folder fall back to Uncategorized server-side
  // (functions/api/tenant/media-folders/[id].ts) - never deleted. If the
  // deleted folder was the one currently selected, fall back the view to
  // "All files" too, so the page doesn't keep pointing at a folder that
  // no longer exists.
  async function handleDeleteFolder(folder: MediaFolder) {
    const warning =
      folder.fileCount > 0
        ? `Delete "${folder.name}"? Its ${folder.fileCount} file${folder.fileCount === 1 ? '' : 's'} will move to Uncategorized, not be deleted.`
        : `Delete "${folder.name}"?`
    if (!window.confirm(warning)) return

    await fetch(`${MEDIA_FOLDERS_URL}/${folder.id}`, { method: 'DELETE' })
    if (selectedFolderId === folder.id) setSelectedFolderId('all')
    await Promise.all([loadFolders(), loadLibrary()])
  }

  const uncategorizedCount = files.filter((f) => f.folderId === null).length
  const visibleFiles = selectedFolderId === 'all' ? files : files.filter((f) => f.folderId === selectedFolderId)
  const selectedFolderLabel =
    selectedFolderId === 'all' ? 'All files' : selectedFolderId === null ? 'Uncategorized' : folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder'

  return (
    <>
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Media Library</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Upload images, MP4 clips, and PDFs here, then tag each one for which screen(s) it's usable on
          (Dashboard/Café/Both) and its orientation. Assign files to carousel slots from Dashboard Manager or Cafe
          Media - each page's Source dropdown only shows files tagged for it.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <section className="rounded-2xl border border-border bg-panel p-6">
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

            {/* Folder sidebar (within this page, distinct from the app's
                main admin sidebar) + the selected folder's compact file
                list. Stacks below lg. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
              <FolderSidebar
                folders={folders}
                totalFileCount={files.length}
                uncategorizedCount={uncategorizedCount}
                selectedFolderId={selectedFolderId}
                onSelect={setSelectedFolderId}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
              />

              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-400">{selectedFolderLabel}</div>
                {visibleFiles.length === 0 ? (
                  <p className="text-sm text-muted-500">
                    {files.length === 0 ? 'No files uploaded yet.' : `No files in "${selectedFolderLabel}" yet.`}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {visibleFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <FileThumbnail file={file} />
                          <div>
                            <FilenameWithHoverPreview file={file} onRename={(filename) => handleRenameFile(file, filename)} />
                            <div className="text-xs text-muted-500">
                              {file.mediaType}
                              {file.mediaType === 'mp4' && file.mp4DurationSeconds
                                ? ` · ${file.mp4DurationSeconds.toFixed(1)}s`
                                : ''}
                              {' · '}
                              {formatMb(file.sizeBytes)} · uploaded {formatDate(file.uploadedAt)}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-1.5 text-xs text-muted-400">
                            Usable on
                            <select
                              value={file.usableOn}
                              onChange={(event) =>
                                handleRetagFile(file, { usableOn: event.target.value as MediaLibraryFile['usableOn'] })
                              }
                              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                            >
                              <option value="dashboard">Dashboard</option>
                              <option value="cafe">Café</option>
                              <option value="both">Both</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-400">
                            Orientation
                            <select
                              value={file.orientation}
                              onChange={(event) =>
                                handleRetagFile(file, { orientation: event.target.value as MediaLibraryFile['orientation'] })
                              }
                              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                            >
                              <option value="16:9">16:9</option>
                              <option value="9:16">9:16</option>
                              <option value="both">Both</option>
                            </select>
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-400">
                            Move to
                            <select
                              value={file.folderId ?? ''}
                              onChange={(event) => handleMoveFile(file, event.target.value || null)}
                              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                            >
                              <option value="">Uncategorized</option>
                              {folders.map((folder) => (
                                <option key={folder.id} value={folder.id}>
                                  {folder.name}
                                </option>
                              ))}
                            </select>
                          </label>
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
              </div>
            </div>
          </section>
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
