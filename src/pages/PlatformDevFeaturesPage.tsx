import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PLATFORM_DEV_FEATURES_URL,
  PLATFORM_DEV_FEATURE_FOLDERS_URL,
  platformDevFeatureUrl,
} from '../config/publicApi'

type DevFeatureStatus = 'idea' | 'planned' | 'built' | 'parked'

interface DevFeatureEntry {
  id: string
  linkedFeatureRequestId: string | null
  status: DevFeatureStatus
  notes: string | null
  folderId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  title: string
  description: string
  submittedByTenantName: string | null
}

interface Folder {
  id: string
  name: string
  createdAt: string
}

const STATUSES: DevFeatureStatus[] = ['idea', 'planned', 'built', 'parked']

const STATUS_LABELS: Record<DevFeatureStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  built: 'Built',
  parked: 'Parked',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Internal, developer-only workspace (migration 0067) - mirrors every
// /features submission read-through (title/description always reflect
// the live public entry, never a stale copy), plus lets the developer
// add entries with no public origin at all. Marking an entry 'built' for
// the first time auto-creates a draft on the Developer Updates page;
// releasing that draft into a version reports back to the original
// /features entry as 'Built' - both are one-way triggers, handled
// entirely server-side, nothing on this page drives them directly beyond
// the status change itself.
export default function PlatformDevFeaturesPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [entries, setEntries] = useState<DevFeatureEntry[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  const [completionNotice, setCompletionNotice] = useState<string | null>(null)

  function loadAll() {
    return Promise.all([
      fetch(PLATFORM_DEV_FEATURES_URL).then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      }),
      fetch(PLATFORM_DEV_FEATURE_FOLDERS_URL).then((response) => (response.ok ? response.json() : null)),
    ]).then(([entriesData, foldersData]) => {
      if (entriesData) setEntries(entriesData.entries ?? [])
      if (foldersData) setFolders(foldersData.folders ?? [])
    })
  }

  useEffect(() => {
    loadAll().finally(() => setLoading(false))
  }, [])

  async function handleCreateEntry() {
    const title = newTitle.trim()
    const description = newDescription.trim()
    if (!title || !description) return
    setCreating(true)
    const response = await fetch(PLATFORM_DEV_FEATURES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    })
    if (response.ok) {
      setNewTitle('')
      setNewDescription('')
      await loadAll()
    }
    setCreating(false)
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim()
    if (!name) return
    setCreatingFolder(true)
    const response = await fetch(PLATFORM_DEV_FEATURE_FOLDERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      setNewFolderName('')
      await loadAll()
    }
    setCreatingFolder(false)
  }

  async function patchEntry(entry: DevFeatureEntry, patch: Record<string, unknown>) {
    const response = await fetch(platformDevFeatureUrl(entry.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!response.ok) return
    const data = await response.json()
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...patch, completedAt: data.completedAt } : e)))
    if (data.createdUpdateId) {
      setCompletionNotice(`"${entry.title}" marked Built - a draft entry was created on Developer Updates.`)
      window.setTimeout(() => setCompletionNotice(null), 4000)
    }
  }

  function handleStatusChange(entry: DevFeatureEntry, status: DevFeatureStatus) {
    patchEntry(entry, { status })
  }

  function handleFolderChange(entry: DevFeatureEntry, folderId: string) {
    patchEntry(entry, { folderId: folderId || null })
  }

  function handleNotesBlur(entry: DevFeatureEntry, notes: string) {
    if (notes === (entry.notes ?? '')) return
    patchEntry(entry, { notes: notes || null })
  }

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders])

  const visibleEntries = useMemo(() => {
    let list = entries
    if (selectedFolderId !== 'all') {
      list = list.filter((e) => e.folderId === selectedFolderId)
    }
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return sortOrder === 'newest' ? sorted.reverse() : sorted
  }, [entries, selectedFolderId, sortOrder])

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <Link to="/platform/tenants" className="mb-4 inline-block text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          ← Platform · Tenants
        </Link>
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Developer Features</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Every /features submission (title/description always live, never a copy), plus your own private entries.
          Marking an entry Built creates a draft on Developer Updates; releasing that draft reports back to the
          original /features entry.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            {completionNotice && (
              <div className="mb-6 rounded-lg border border-status-good/40 bg-status-good/10 px-4 py-2 text-sm font-semibold text-status-good">
                {completionNotice}
              </div>
            )}

            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">New private entry</div>
              <div className="flex flex-col gap-3">
                <input
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Title"
                  className="w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white"
                />
                <textarea
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder="Description"
                  rows={2}
                  className="w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={handleCreateEntry}
                  disabled={creating || !newTitle.trim() || !newDescription.trim()}
                  className="self-start rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? 'Adding…' : '+ Add private entry'}
                </button>
              </div>
            </section>

            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Folders</div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="New folder name"
                  className="rounded border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400 disabled:opacity-50"
                >
                  + Create folder
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedFolderId('all')}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                    selectedFolderId === 'all' ? 'bg-accent-sky-500 text-white' : 'bg-slate-800 text-muted-400 hover:text-white'
                  }`}
                >
                  All ({entries.length})
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      selectedFolderId === folder.id ? 'bg-accent-sky-500 text-white' : 'bg-slate-800 text-muted-400 hover:text-white'
                    }`}
                  >
                    {folder.name} ({entries.filter((e) => e.folderId === folder.id).length})
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">
                  Entries ({visibleEntries.length})
                </div>
                <button
                  type="button"
                  onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
                  className="text-xs font-semibold text-muted-400 hover:text-white"
                >
                  Sort: {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'} ↕
                </button>
              </div>

              {visibleEntries.length === 0 && <p className="text-xs text-muted-500">Nothing here yet.</p>}

              <div className="flex flex-col gap-3">
                {visibleEntries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[220px] flex-1">
                        <div className="text-sm font-semibold text-white">{entry.title}</div>
                        <p className="mt-1 text-sm text-muted-400">{entry.description}</p>
                        <div className="mt-2 text-xs text-muted-500">
                          {entry.linkedFeatureRequestId
                            ? `From /features · ${entry.submittedByTenantName ?? 'Unknown tenant'}`
                            : 'Private entry'}{' '}
                          · {formatDate(entry.createdAt)}
                          {entry.folderId && folderName.get(entry.folderId) && ` · ${folderName.get(entry.folderId)}`}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <select
                          value={entry.status}
                          onChange={(event) => handleStatusChange(entry, event.target.value as DevFeatureStatus)}
                          className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs font-semibold text-white focus:border-sky-500 focus:outline-none"
                        >
                          {STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <select
                          value={entry.folderId ?? ''}
                          onChange={(event) => handleFolderChange(entry, event.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
                        >
                          <option value="">No folder</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <textarea
                      defaultValue={entry.notes ?? ''}
                      onBlur={(event) => handleNotesBlur(entry, event.target.value)}
                      placeholder="Private notes…"
                      rows={2}
                      className="w-full rounded border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
