import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { MediaFolder, MediaLibraryFile } from '../types/mediaLibrary'
import { MEDIA_FOLDERS_URL, MEDIA_LIBRARY_UPLOAD_URL, MEDIA_LIBRARY_URL } from '../config/publicApi'

// Dynamic import - keeps fabric.js and the self-hosted slide fonts
// (~90KB+ gzipped combined) out of every bundle except the one fetched
// when a Media Library user actually clicks "Create Slide"/"Edit
// Slide".
const SlideEditor = lazy(() => import('../components/media/SlideEditor'))

type ScreenId = 'dashboard' | 'cafe'
type ViewMode = 'grid' | 'list'

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
// PDF's first page client-side. sizeClass parameterized (was a fixed
// h-14 w-14) - the grid tile, list row, and inspector's own larger
// preview all want different sizes from the same component instead of
// three near-duplicate thumbnail implementations.
function FileThumbnail({ file, sizeClass = 'h-14 w-14' }: { file: MediaLibraryFile; sizeClass?: string }): JSX.Element {
  const boxClass = `flex ${sizeClass} flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-800`

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

// Tiny at-a-glance indicator of which screen(s) a file is tagged for -
// optional per your instruction, added since it costs little and saves
// a click to check the common case. Colour-coded (not just the letter)
// so it's distinguishable even at a glance without reading the letter -
// slate for Dashboard, amber for Café, sky (this app's own accent
// colour, already used elsewhere for "applies broadly") for Both.
function ScreenTagBadge({ usableOn }: { usableOn: MediaLibraryFile['usableOn'] }): JSX.Element {
  const config: Record<MediaLibraryFile['usableOn'], { label: string; bg: string; title: string }> = {
    dashboard: { label: 'D', bg: 'bg-slate-600', title: 'Usable on: Dashboard' },
    cafe: { label: 'C', bg: 'bg-amber-600', title: 'Usable on: Café' },
    both: { label: 'B', bg: 'bg-accent-sky-500', title: 'Usable on: Both' },
  }
  const { label, bg, title } = config[usableOn]
  return (
    <span
      title={title}
      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-slate-950 ${bg}`}
    >
      {label}
    </span>
  )
}

// A literal little rectangle communicates landscape/portrait/both more
// intuitively at this size than a 2-3 character text badge would - and
// avoids colliding with ScreenTagBadge's own letter scheme ('B' means
// something different in each badge, which reads fine as two separate
// colour-coded shapes but would be genuinely ambiguous as two identical
// letter chips sitting next to each other).
function OrientationBadge({ orientation }: { orientation: MediaLibraryFile['orientation'] }): JSX.Element {
  const title =
    orientation === '16:9' ? 'Orientation: 16:9 (landscape)' : orientation === '9:16' ? 'Orientation: 9:16 (portrait)' : 'Orientation: Both'
  const shapeClass = orientation === '16:9' ? 'h-1.5 w-2.5' : orientation === '9:16' ? 'h-2.5 w-1.5' : 'h-2 w-2'
  return (
    <span title={title} className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-slate-950 ring-2 ring-slate-950">
      <span className={`${shapeClass} rounded-[1px] bg-white`} />
    </span>
  )
}

// One file, in either the grid (icon view) or list view - a single
// component for both since the click/selected/badge logic is identical,
// only the layout differs. Selection-only click target: no per-tile
// controls at all (Part C) - the file's controls live exclusively in
// FileInspector below, shown once, for whichever one file is selected.
function FileTile({
  file,
  view,
  selected,
  onSelect,
}: {
  file: MediaLibraryFile
  view: ViewMode
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  if (view === 'list') {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
          selected ? 'border-accent-sky-500 bg-accent-sky-500/10' : 'border-transparent bg-card hover:border-slate-600'
        }`}
      >
        <div className="relative flex-shrink-0">
          <FileThumbnail file={file} sizeClass="h-10 w-10" />
          <span className="absolute -left-1.5 -top-1.5">
            <ScreenTagBadge usableOn={file.usableOn} />
          </span>
        </div>
        <span className={`min-w-0 flex-1 truncate text-sm ${selected ? 'font-semibold text-white' : 'text-muted-300'}`}>
          {file.filename}
        </span>
        <OrientationBadge orientation={file.orientation} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition ${
        selected ? 'border-accent-sky-500 bg-accent-sky-500/10' : 'border-transparent hover:bg-slate-800/60'
      }`}
    >
      <div className="relative">
        <FileThumbnail file={file} sizeClass="h-16 w-16" />
        <span className="absolute -left-1.5 -top-1.5">
          <ScreenTagBadge usableOn={file.usableOn} />
        </span>
        <span className="absolute -right-1.5 -top-1.5">
          <OrientationBadge orientation={file.orientation} />
        </span>
      </div>
      <span className="w-full truncate text-xs text-muted-300">{file.filename}</span>
    </button>
  )
}

// Shared Mac-Finder-style click-to-edit behaviour: click to start, Enter
// or blur (clicking away) saves, Escape cancels and reverts with no
// save. Used by the inspector's filename field and the folder sidebar's
// rename, so both share the exact same save/cancel keys and empty-name
// handling rather than two subtly different implementations.
//
// A React hook, not a plain function - components using it (FileInspector,
// FolderRow) call it exactly once per own render, which is what makes it
// legal; it must never be called conditionally or inside a loop/.map()
// callback directly (that would call useState/useRef a varying number of
// times across renders and break React's hook order).
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

// The single control area (Part C) - appears once a file is selected,
// covering everything a per-row control sprawl used to: rename, Usable
// on, Orientation, Move to, Edit Slide, Delete. Nothing here affects any
// file OTHER than the one passed in. `file` is looked up from the FULL
// (not screen/folder-filtered) file list by the parent, deliberately -
// retagging a file so it no longer matches the current Dashboard Media/
// Cafe Media toggle must not yank the inspector out from under the
// control the user is mid-click on.
function FileInspector({
  file,
  folders,
  onRename,
  onRetag,
  onMove,
  onDelete,
  onEditSlide,
  onClose,
}: {
  file: MediaLibraryFile
  folders: MediaFolder[]
  onRename: (filename: string) => void
  onRetag: (patch: { usableOn?: MediaLibraryFile['usableOn']; orientation?: MediaLibraryFile['orientation'] }) => void
  onMove: (folderId: string | null) => void
  onDelete: () => void
  onEditSlide: () => void
  onClose: () => void
}): JSX.Element {
  const nameEdit = useInlineEdit(file.filename, onRename)

  return (
    <div className="w-full flex-shrink-0 rounded-xl border border-border bg-card p-4 lg:w-72">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-widest text-accent-sky-400">Selected File</div>
        <button type="button" onClick={onClose} aria-label="Deselect" className="text-sm leading-none text-muted-500 hover:text-primary">
          ×
        </button>
      </div>

      <div className="mb-3 flex h-32 w-full items-center justify-center overflow-hidden rounded-lg bg-slate-800">
        {file.mediaType === 'image' && file.url && <img src={file.url} alt="" className="h-full w-full object-contain" />}
        {file.mediaType === 'mp4' && file.url && (
          <video src={file.url} className="h-full w-full object-contain" muted controls preload="metadata" />
        )}
        {file.mediaType === 'pdf' && <span className="text-6xl">📄</span>}
      </div>

      {nameEdit.editing ? (
        <input
          ref={nameEdit.inputRef}
          type="text"
          value={nameEdit.draft}
          onChange={(event) => nameEdit.setDraft(event.target.value)}
          onBlur={nameEdit.commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              nameEdit.commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              nameEdit.cancel()
            }
          }}
          aria-label={`Rename ${file.filename}`}
          className="mb-1 w-full rounded border border-accent-sky-500/60 bg-slate-900/80 px-1.5 py-0.5 text-sm font-semibold text-white focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={nameEdit.startEditing}
          title="Click to rename"
          className="mb-1 block w-full truncate text-left text-sm font-semibold text-white decoration-dotted hover:underline"
        >
          {file.filename}
        </button>
      )}
      <div className="mb-4 text-xs text-muted-500">
        {file.mediaType}
        {file.mediaType === 'mp4' && file.mp4DurationSeconds ? ` · ${file.mp4DurationSeconds.toFixed(1)}s` : ''}
        {' · '}
        {formatMb(file.sizeBytes)} · uploaded {formatDate(file.uploadedAt)}
      </div>

      <label className="mb-3 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Usable on</span>
        <select
          value={file.usableOn}
          onChange={(event) => onRetag({ usableOn: event.target.value as MediaLibraryFile['usableOn'] })}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="dashboard">Dashboard</option>
          <option value="cafe">Café</option>
          <option value="both">Both</option>
        </select>
      </label>

      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Orientation</span>
        <select
          value={file.orientation}
          onChange={(event) => onRetag({ orientation: event.target.value as MediaLibraryFile['orientation'] })}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="both">Both</option>
        </select>
      </label>

      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Move to</span>
        <select
          value={file.folderId ?? ''}
          onChange={(event) => onMove(event.target.value || null)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="">Uncategorized</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        {file.slideRecipe ? (
          <button type="button" onClick={onEditSlide} className="text-xs font-semibold text-accent-sky-400">
            ✏️ Edit Slide
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={onDelete} className="text-xs font-semibold text-status-bad">
          Delete
        </button>
      </div>
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

// Auto-detects orientation from the file's actual pixel dimensions where
// possible - image via a plain Image() load, mp4 via a <video> element's
// loadedmetadata event (same technique, and same off-DOM approach, as
// probeMp4Duration above). Landscape/square buckets to '16:9', portrait
// to '9:16' - the schema only has 3 buckets, not a continuous ratio, so
// this is a genuine mapping, not an approximation of one. pdf has no
// reliable client-side dimension read and is left at the upload
// endpoint's own '16:9' fallback default. Resolves null on any load
// failure so a broken/corrupt file never blocks the upload itself - same
// null-on-error posture as probeMp4Duration.
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
// than window.prompt(). Kept exactly as it was before this round's
// rework, per instruction.
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

  // Which screen's view this page is showing - filters the file browser
  // below to usableOn === activeScreen || 'both', same toggle pattern
  // already used on Screens Design and Cafe Media. This is a VIEW filter
  // only - one shared storage pool, one shared quota (the storage bar
  // below always reflects the true combined totalBytes regardless of
  // this value), never a separate library per screen.
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  // Info icon popover - same self-contained pattern (no toast/popover
  // library anywhere in this codebase) already established on Screens
  // Design: toggled by the icon, dismissed by the icon again, its own
  // close button, or a click anywhere outside it.
  const [infoOpen, setInfoOpen] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!infoOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(event.target as Node)) {
        setInfoOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [infoOpen])

  function loadLibrary() {
    return fetch(MEDIA_LIBRARY_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return
        setFiles(data.files ?? [])
        // Always the TRUE combined total across every file regardless of
        // tag - the server computes this over the whole org's library,
        // not whatever the current screen filter shows, so the storage
        // bar below never needs (and must never be given) a locally
        // recomputed per-view sum.
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

  // Folder switch and screen-toggle both clear selection, matching
  // Finder's own "navigating away deselects" convention - simpler and
  // more predictable than trying to carry a selection across a view
  // change where the selected file might not even be visible anymore.
  function selectFolder(id: string | null | 'all') {
    setSelectedFolderId(id)
    setSelectedFileId(null)
  }

  function selectScreen(screen: ScreenId) {
    setActiveScreen(screen)
    setSelectedFileId(null)
  }

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

    // usableOn always sent as whichever screen's toggle is currently
    // active (never left to the endpoint's own 'both' default) - a
    // fresh upload made while looking at the Cafe Media view should
    // come out tagged 'cafe', matching every other screen this session
    // established ("new content defaults to the context you're in").
    const params = new URLSearchParams({ filename: file.name, mediaType, usableOn: activeScreen })
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
    setSelectedFileId((prev) => (prev === file.id ? null : prev))
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

  // Retags usableOn/orientation - same metadata-only PATCH pattern as
  // handleMoveFile above, just a different field. Selection is
  // deliberately left untouched here (see FileInspector's own comment)
  // even though the retagged file may no longer match the current
  // Dashboard Media/Cafe Media filter afterward.
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
  const folderFilteredFiles = selectedFolderId === 'all' ? files : files.filter((f) => f.folderId === selectedFolderId)
  // Folder AND screen-tag both apply, per instruction - a file must
  // match both to be visible. 'both'-tagged files pass this filter for
  // either screen, by design (not a bug).
  const visibleFiles = folderFilteredFiles.filter((f) => f.usableOn === activeScreen || f.usableOn === 'both')
  const selectedFolderLabel =
    selectedFolderId === 'all' ? 'All files' : selectedFolderId === null ? 'Uncategorized' : folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder'
  // Looked up from the FULL list, not visibleFiles - see FileInspector's
  // own comment on why the inspector must stay valid across a retag that
  // moves the file out of the current filter.
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

  return (
    <>
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-10">
        {/* Stacks by default, side-by-side only from xl (1280px) up -
            this page's own container tops out at max-w-6xl (1152px), a
            good deal narrower than Screens Design's 1900px, so it
            doesn't need that page's much higher custom min-[1800px]
            threshold - xl is comfortably past the worst-case width this
            row's own content (title + icon + two longer-than-Screens-
            Design's-own "Dashboard Media"/"Cafe Media" labelled toggle
            buttons) needs, including the same viewport-height-dependent
            rem scaling (index.css's clamp()-based root font-size) that
            made a plain flex-wrap approach unreliable there. */}
        <div className="mb-6 flex flex-col items-start gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black uppercase tracking-wide text-primary">Media Library</h1>
            <div ref={infoRef} className="relative">
              <button
                type="button"
                onClick={() => setInfoOpen((open) => !open)}
                aria-label="About this page"
                aria-expanded={infoOpen}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-bold text-muted-500 transition hover:border-accent-sky-500 hover:text-accent-sky-400"
              >
                i
              </button>
              {infoOpen && (
                <div className="absolute left-0 top-full z-20 mt-2 w-80 rounded-lg border border-border bg-slate-900 p-4 shadow-xl">
                  <button
                    type="button"
                    onClick={() => setInfoOpen(false)}
                    aria-label="Close"
                    className="absolute right-2 top-2 text-sm leading-none text-muted-500 hover:text-primary"
                  >
                    ×
                  </button>
                  <p className="pr-4 text-sm text-muted-400">
                    Upload images, MP4 clips, and PDFs here, then tag each one for which screen(s) it's usable on
                    (Dashboard/Café/Both) and its orientation. Assign files to carousel slots from Dashboard
                    Manager or Cafe Media - each page's Source dropdown only shows files tagged for it.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-slate-900/80 p-1">
            {(['dashboard', 'cafe'] as const).map((screen) => (
              <button
                key={screen}
                type="button"
                onClick={() => selectScreen(screen)}
                className={`rounded-md px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                  activeScreen === screen ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-primary'
                }`}
              >
                {screen === 'dashboard' ? 'Dashboard Media' : 'Cafe Media'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <section className="rounded-2xl border border-border bg-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Media Library</div>
              {/* Always the combined total, independent of the Dashboard
                  Media/Cafe Media toggle above - one shared storage pool,
                  one shared quota, per instruction. */}
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
                main admin sidebar) + the selected folder's file browser.
                Stacks below lg. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
              <FolderSidebar
                folders={folders}
                totalFileCount={files.length}
                uncategorizedCount={uncategorizedCount}
                selectedFolderId={selectedFolderId}
                onSelect={selectFolder}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
              />

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-widest text-muted-400">{selectedFolderLabel}</div>
                  <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-slate-900/80 p-1">
                    {(['grid', 'list'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                        aria-label={mode === 'grid' ? 'Grid view' : 'List view'}
                        aria-pressed={viewMode === mode}
                        title={mode === 'grid' ? 'Grid view' : 'List view'}
                        className={`rounded-md px-3 py-1 text-sm transition ${
                          viewMode === mode ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-primary'
                        }`}
                      >
                        {mode === 'grid' ? '⊞' : '☰'}
                      </button>
                    ))}
                  </div>
                </div>

                {visibleFiles.length === 0 ? (
                  <p className="text-sm text-muted-500">
                    {files.length === 0
                      ? 'No files uploaded yet.'
                      : folderFilteredFiles.length === 0
                        ? `No files in "${selectedFolderLabel}" yet.`
                        : `No files tagged for ${activeScreen === 'dashboard' ? 'Dashboard' : 'Café'} in "${selectedFolderLabel}".`}
                  </p>
                ) : (
                  <div className="flex flex-col gap-4 lg:flex-row">
                    {/* Clicking empty space (not a file tile) deselects -
                        e.target === e.currentTarget only when the click
                        lands on this wrapper div itself, never when it
                        bubbles up from a FileTile <button>. */}
                    <div
                      className={
                        viewMode === 'grid'
                          ? 'grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3'
                          : 'flex min-w-0 flex-1 flex-col gap-1.5'
                      }
                      onClick={(event) => {
                        if (event.target === event.currentTarget) setSelectedFileId(null)
                      }}
                    >
                      {visibleFiles.map((file) => (
                        <FileTile
                          key={file.id}
                          file={file}
                          view={viewMode}
                          selected={file.id === selectedFileId}
                          onSelect={() => setSelectedFileId(file.id)}
                        />
                      ))}
                    </div>

                    {selectedFile && (
                      <FileInspector
                        file={selectedFile}
                        folders={folders}
                        onRename={(filename) => handleRenameFile(selectedFile, filename)}
                        onRetag={(patch) => handleRetagFile(selectedFile, patch)}
                        onMove={(folderId) => handleMoveFile(selectedFile, folderId)}
                        onDelete={() => handleDeleteFile(selectedFile)}
                        onEditSlide={() => setEditingSlideFile(selectedFile)}
                        onClose={() => setSelectedFileId(null)}
                      />
                    )}
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
            defaultUsableOn={activeScreen}
          />
        </Suspense>
      )}
    </>
  )
}
