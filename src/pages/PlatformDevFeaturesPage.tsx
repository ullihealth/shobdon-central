import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PLATFORM_DEV_FEATURES_URL,
  PLATFORM_DEV_FEATURE_FOLDERS_URL,
  PLATFORM_UPDATES_RELEASE_URL,
  platformDevFeatureUrl,
} from '../config/publicApi'

type Tab = 'all' | 'reviewed' | 'devlog'
type SortMode = 'newest' | 'oldest' | 'title-asc' | 'title-desc'

interface DevFeatureEntry {
  id: string
  linkedFeatureRequestId: string | null
  notes: string | null
  folderId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  eligibleForRelease: boolean
  releasedUpdateId: string | null
  releasedVersion: string | null
  title: string
  description: string
  submittedByTenantName: string | null
}

interface Folder {
  id: string
  name: string
  createdAt: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// REVIEWED/DEV LOG membership is derived from three plain columns, not
// a stored "which tab" value of its own - completedAt/eligibleForRelease/
// releasedUpdateId are the actual facts; the tab is just a filter over
// them. An entry with completedAt still null belongs to neither tab
// (ALL only) - it hasn't gone through Complete yet.
function matchesTab(entry: DevFeatureEntry, tab: Tab): boolean {
  if (tab === 'all') return true
  if (entry.completedAt === null) return false
  if (tab === 'reviewed') return entry.eligibleForRelease && entry.releasedUpdateId === null
  return !entry.eligibleForRelease
}

// Dev-features/Updates consolidation round: this page is now the SOLE
// entry-creation and pre-release workflow surface for the whole Updates
// system - the old /platform/updates New Draft Entry form and its own
// Pending/Reviewed containers are gone, folded into this one "New
// entry" form and the REVIEWED tab below (see that page's own comment).
// Mirrors every /features submission read-through (title/description
// always reflect the live public entry, never a stale copy), plus lets
// the developer add entries with no public origin at all - those get a
// small DEV badge to distinguish them in the list.
//
// The old idea/planned/built/parked status concept (migration 0067) is
// retired - completedAt/eligibleForRelease/releasedUpdateId fully
// replace what "marking an entry Built" used to mean, and there's no
// equivalent of idea/planned/parked in this model at all.
export default function PlatformDevFeaturesPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [entries, setEntries] = useState<DevFeatureEntry[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all')
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [sortMode, setSortMode] = useState<SortMode>('newest')

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  const [notice, setNotice] = useState<string | null>(null)

  const [selectedForRelease, setSelectedForRelease] = useState<Set<string>>(new Set())
  const [releaseVersion, setReleaseVersion] = useState('')
  const [releasing, setReleasing] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)

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

  function showNotice(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 4000)
  }

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
    if (!response.ok) return null
    const data = await response.json()
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, ...data } : e)))
    return data
  }

  function handleEligibleChange(entry: DevFeatureEntry, eligible: boolean) {
    patchEntry(entry, { eligibleForRelease: eligible })
  }

  async function handleComplete(entry: DevFeatureEntry) {
    const data = await patchEntry(entry, { completed: true })
    if (data) {
      showNotice(`"${entry.title}" marked complete - now in the ${entry.eligibleForRelease ? 'Reviewed' : 'Dev Log'} tab.`)
    }
  }

  function handleFolderChange(entry: DevFeatureEntry, folderId: string) {
    patchEntry(entry, { folderId: folderId || null })
  }

  function handleNotesBlur(entry: DevFeatureEntry, notes: string) {
    if (notes === (entry.notes ?? '')) return
    patchEntry(entry, { notes: notes || null })
  }

  function toggleSelectedForRelease(id: string) {
    setSelectedForRelease((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleRelease() {
    setReleaseError(null)
    const version = releaseVersion.trim()
    if (!version) {
      setReleaseError('Enter a version number.')
      return
    }
    if (selectedForRelease.size === 0) {
      setReleaseError('Select at least one reviewed entry.')
      return
    }
    setReleasing(true)
    const response = await fetch(PLATFORM_UPDATES_RELEASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedForRelease), version }),
    })
    if (response.ok) {
      setSelectedForRelease(new Set())
      setReleaseVersion('')
      showNotice(`Released v${version.replace(/^v/i, '')}.`)
      await loadAll()
    } else {
      const body = await response.json().catch(() => null)
      setReleaseError(body?.error ?? "Couldn't release - please try again.")
    }
    setReleasing(false)
  }

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders])

  const visibleEntries = useMemo(() => {
    let list = entries
    if (selectedFolderId !== 'all') list = list.filter((e) => e.folderId === selectedFolderId)
    list = list.filter((e) => matchesTab(e, activeTab))
    const sorted = [...list]
    if (sortMode === 'newest') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else if (sortMode === 'oldest') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    else if (sortMode === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else sorted.sort((a, b) => b.title.localeCompare(a.title))
    return sorted
  }, [entries, selectedFolderId, activeTab, sortMode])

  const tabCounts = useMemo(
    () => ({
      all: entries.length,
      reviewed: entries.filter((e) => matchesTab(e, 'reviewed')).length,
      devlog: entries.filter((e) => matchesTab(e, 'devlog')).length,
    }),
    [entries]
  )

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
          Every /features submission (title/description always live, never a copy), plus your own entries. Tick
          "Eligible for release" before marking an entry Complete to route it to Reviewed instead of Dev Log; release
          Reviewed entries into a version from that tab below.{' '}
          <Link to="/platform/updates" className="text-accent-sky-400 hover:text-accent-sky-500">
            See what's already shipped →
          </Link>
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            {notice && (
              <div className="mb-6 rounded-lg border border-status-good/40 bg-status-good/10 px-4 py-2 text-sm font-semibold text-status-good">
                {notice}
              </div>
            )}

            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">New entry</div>
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
                  {creating ? 'Adding…' : '+ Add entry'}
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
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  {(['all', 'reviewed', 'devlog'] as Tab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                        activeTab === tab ? 'bg-accent-sky-500 text-white' : 'border border-border text-muted-400 hover:text-white'
                      }`}
                    >
                      {tab === 'all' ? 'All' : tab === 'reviewed' ? 'Reviewed' : 'Dev Log'} (
                      {tab === 'all' ? tabCounts.all : tab === 'reviewed' ? tabCounts.reviewed : tabCounts.devlog})
                    </button>
                  ))}
                </div>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title-asc">Title A–Z</option>
                  <option value="title-desc">Title Z–A</option>
                </select>
              </div>

              {activeTab === 'reviewed' && tabCounts.reviewed > 0 && (
                <div className="mb-6 rounded-xl border border-accent-sky-500/40 bg-accent-sky-500/5 p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-widest text-accent-sky-400">
                    Release {selectedForRelease.size} selected {selectedForRelease.size === 1 ? 'entry' : 'entries'}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      value={releaseVersion}
                      onChange={(event) => setReleaseVersion(event.target.value)}
                      placeholder="Version, e.g. 1.0.14"
                      className="w-48 rounded border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={handleRelease}
                      disabled={releasing || selectedForRelease.size === 0 || !releaseVersion.trim()}
                      className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {releasing ? 'Releasing…' : 'Release'}
                    </button>
                    {releaseError && <span className="text-sm text-status-bad">{releaseError}</span>}
                  </div>
                </div>
              )}

              {visibleEntries.length === 0 && <p className="text-xs text-muted-500">Nothing here yet.</p>}

              <div className="flex flex-col gap-3">
                {visibleEntries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[220px] flex-1">
                        <div className="flex items-center gap-2">
                          {!entry.linkedFeatureRequestId && (
                            <span className="rounded border border-amber-500/40 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                              DEV
                            </span>
                          )}
                          <div className="text-sm font-semibold text-white">{entry.title}</div>
                        </div>
                        <p className="mt-1 text-sm text-muted-400">{entry.description}</p>
                        <div className="mt-2 text-xs text-muted-500">
                          {entry.linkedFeatureRequestId
                            ? `From /features · ${entry.submittedByTenantName ?? 'Unknown tenant'}`
                            : 'Private entry'}{' '}
                          · {formatDate(entry.createdAt)}
                          {entry.folderId && folderName.get(entry.folderId) && ` · ${folderName.get(entry.folderId)}`}
                          {entry.releasedVersion && (
                            <span className="ml-1 font-semibold text-status-good">
                              · Released v{entry.releasedVersion.replace(/^v/i, '')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {activeTab === 'reviewed' && (
                          <input
                            type="checkbox"
                            checked={selectedForRelease.has(entry.id)}
                            onChange={() => toggleSelectedForRelease(entry.id)}
                            className="h-4 w-4 accent-accent-sky-500"
                            title="Select for release"
                          />
                        )}
                        <select
                          value={entry.folderId ?? ''}
                          onChange={(event) => handleFolderChange(entry, event.target.value)}
                          disabled={!!entry.releasedUpdateId}
                          className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
                        >
                          <option value="">No folder</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </select>
                        {!entry.releasedUpdateId && (
                          <label className="flex items-center gap-1.5 text-xs text-muted-400">
                            <input
                              type="checkbox"
                              checked={entry.eligibleForRelease}
                              disabled={!!entry.completedAt}
                              onChange={(event) => handleEligibleChange(entry, event.target.checked)}
                              className="h-3.5 w-3.5 accent-accent-sky-500"
                            />
                            Eligible for release
                          </label>
                        )}
                        {!entry.completedAt && !entry.releasedUpdateId && (
                          <button
                            type="button"
                            onClick={() => handleComplete(entry)}
                            className="rounded-lg bg-accent-sky-500 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400"
                          >
                            Complete
                          </button>
                        )}
                        {entry.completedAt && !entry.releasedUpdateId && (
                          <span className="text-[11px] text-muted-500">Completed {formatDate(entry.completedAt)}</span>
                        )}
                      </div>
                    </div>
                    <textarea
                      defaultValue={entry.notes ?? ''}
                      onBlur={(event) => handleNotesBlur(entry, event.target.value)}
                      placeholder="Private notes…"
                      rows={2}
                      disabled={!!entry.releasedUpdateId}
                      className="w-full rounded border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-white disabled:opacity-50"
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
