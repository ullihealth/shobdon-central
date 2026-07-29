import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_UPDATES_URL, PLATFORM_UPDATES_RELEASE_URL, platformUpdateUrl } from '../config/publicApi'

interface UpdateEntry {
  id: string
  title: string
  description: string
  status: 'draft' | 'reviewed' | 'released'
  version: string | null
  createdAt: string
  releasedAt: string | null
}

type SaveStatus = 'idle' | 'working' | 'success' | 'error'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Internal, app-wide running changelog (migration 0050) - deliberately
// NOT tenant-facing, see that migration's own comment. Workflow: a
// draft entry gets created here (title + short description) as part of
// wrapping up a change; once it's ready it's marked Reviewed; a batch
// of reviewed entries then gets assigned one version number together
// and marked Released, becoming the permanent, no-longer-editable
// record shown in the Released section below.
export default function PlatformUpdatesPage(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [updates, setUpdates] = useState<UpdateEntry[]>([])

  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [createStatus, setCreateStatus] = useState<SaveStatus>('idle')

  // Per-entry save status, keyed by id - independent rows can be
  // mid-save simultaneously without one row's spinner affecting another.
  const [entrySaveStatus, setEntrySaveStatus] = useState<Record<string, SaveStatus>>({})

  const [selectedForRelease, setSelectedForRelease] = useState<Set<string>>(new Set())
  const [releaseVersion, setReleaseVersion] = useState('')
  const [releaseStatus, setReleaseStatus] = useState<SaveStatus>('idle')
  const [releaseError, setReleaseError] = useState<string | null>(null)

  function loadUpdates() {
    return fetch(PLATFORM_UPDATES_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) setUpdates(data.updates ?? [])
      })
  }

  useEffect(() => {
    loadUpdates().finally(() => setLoading(false))
  }, [])

  async function handleCreateDraft() {
    const title = newTitle.trim()
    const description = newDescription.trim()
    if (!title || !description) return
    setCreateStatus('working')
    const response = await fetch(PLATFORM_UPDATES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    })
    if (response.ok) {
      setNewTitle('')
      setNewDescription('')
      setCreateStatus('success')
      await loadUpdates()
      window.setTimeout(() => setCreateStatus('idle'), 1500)
    } else {
      setCreateStatus('error')
    }
  }

  function updateEntryField(id: string, field: 'title' | 'description', value: string) {
    setUpdates((prev) => prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)))
  }

  async function handleSaveEntry(id: string) {
    const entry = updates.find((u) => u.id === id)
    if (!entry) return
    setEntrySaveStatus((prev) => ({ ...prev, [id]: 'working' }))
    const response = await fetch(platformUpdateUrl(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: entry.title, description: entry.description }),
    })
    setEntrySaveStatus((prev) => ({ ...prev, [id]: response.ok ? 'success' : 'error' }))
    if (response.ok) {
      window.setTimeout(() => setEntrySaveStatus((prev) => ({ ...prev, [id]: 'idle' })), 1500)
    }
  }

  async function handleMarkReviewed(id: string) {
    setEntrySaveStatus((prev) => ({ ...prev, [id]: 'working' }))
    const response = await fetch(platformUpdateUrl(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed' }),
    })
    if (response.ok) {
      await loadUpdates()
      setEntrySaveStatus((prev) => ({ ...prev, [id]: 'idle' }))
    } else {
      setEntrySaveStatus((prev) => ({ ...prev, [id]: 'error' }))
    }
  }

  function toggleSelected(id: string) {
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
    setReleaseStatus('working')
    const response = await fetch(PLATFORM_UPDATES_RELEASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedForRelease), version }),
    })
    if (response.ok) {
      setReleaseStatus('success')
      setSelectedForRelease(new Set())
      setReleaseVersion('')
      await loadUpdates()
      window.setTimeout(() => setReleaseStatus('idle'), 1500)
    } else {
      const body = await response.json().catch(() => null)
      setReleaseError(body?.error ?? "Couldn't release - please try again.")
      setReleaseStatus('error')
    }
  }

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

  const pending = updates.filter((entry) => entry.status !== 'released')
  const drafts = pending.filter((entry) => entry.status === 'draft')
  const reviewed = pending.filter((entry) => entry.status === 'reviewed')
  const released = updates.filter((entry) => entry.status === 'released')

  // Group released entries by version, preserving the server's own
  // ordering (newest version first, already sorted) rather than
  // re-sorting client-side.
  const releasedByVersion: { version: string; releasedAt: string | null; entries: UpdateEntry[] }[] = []
  for (const entry of released) {
    const group = releasedByVersion.find((g) => g.version === entry.version)
    if (group) group.entries.push(entry)
    else releasedByVersion.push({ version: entry.version ?? 'unknown', releasedAt: entry.releasedAt, entries: [entry] })
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <Link to="/platform/tenants" className="mb-4 inline-block text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          ← Platform · Tenants
        </Link>
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Developer Updates</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Internal running changelog, not tenant-facing. Add a draft entry as part of wrapping up a change, mark it
          reviewed, then batch reviewed entries into a version to release them into the permanent record below.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">New draft entry</div>
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
                  placeholder="Short description"
                  rows={2}
                  className="w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white"
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCreateDraft}
                    disabled={createStatus === 'working' || !newTitle.trim() || !newDescription.trim()}
                    className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {createStatus === 'working' ? 'Adding…' : '+ Add draft'}
                  </button>
                  {createStatus === 'success' && <span className="text-sm text-status-good">Added.</span>}
                  {createStatus === 'error' && <span className="text-sm text-status-bad">Couldn't add - please try again.</span>}
                </div>
              </div>
            </section>

            <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
              <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Pending ({pending.length})</div>
              <p className="mb-4 text-xs text-muted-500">Draft entries first, then reviewed ones - check reviewed entries below to include them in a release.</p>

              {pending.length === 0 && <p className="text-xs text-muted-500">Nothing pending.</p>}

              <div className="flex flex-col gap-3">
                {[...drafts, ...reviewed].map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 flex items-center gap-3">
                      {entry.status === 'reviewed' && (
                        <input
                          type="checkbox"
                          checked={selectedForRelease.has(entry.id)}
                          onChange={() => toggleSelected(entry.id)}
                          className="h-4 w-4 accent-accent-sky-500"
                          title="Select for release"
                        />
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                          entry.status === 'draft' ? 'bg-slate-800 text-muted-400' : 'bg-accent-sky-500/20 text-accent-sky-400'
                        }`}
                      >
                        {entry.status}
                      </span>
                      <span className="text-xs text-muted-500">{formatDate(entry.createdAt)}</span>
                    </div>
                    <input
                      value={entry.title}
                      onChange={(event) => updateEntryField(entry.id, 'title', event.target.value)}
                      className="mb-2 w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm font-semibold text-white"
                    />
                    <textarea
                      value={entry.description}
                      onChange={(event) => updateEntryField(entry.id, 'description', event.target.value)}
                      rows={2}
                      className="mb-3 w-full rounded border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-white"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleSaveEntry(entry.id)}
                        disabled={entrySaveStatus[entry.id] === 'working'}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400 disabled:opacity-50"
                      >
                        Save
                      </button>
                      {entry.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => handleMarkReviewed(entry.id)}
                          disabled={entrySaveStatus[entry.id] === 'working'}
                          className="rounded-lg bg-accent-sky-500 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
                        >
                          Mark reviewed
                        </button>
                      )}
                      {entrySaveStatus[entry.id] === 'success' && <span className="text-xs text-status-good">Saved.</span>}
                      {entrySaveStatus[entry.id] === 'error' && <span className="text-xs text-status-bad">Couldn't save.</span>}
                    </div>
                  </div>
                ))}
              </div>

              {reviewed.length > 0 && (
                <div className="mt-6 rounded-xl border border-accent-sky-500/40 bg-accent-sky-500/5 p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-widest text-accent-sky-400">
                    Release {selectedForRelease.size} selected {selectedForRelease.size === 1 ? 'entry' : 'entries'}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      value={releaseVersion}
                      onChange={(event) => setReleaseVersion(event.target.value)}
                      placeholder="Version, e.g. 1.6.0"
                      className="w-48 rounded border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={handleRelease}
                      disabled={releaseStatus === 'working' || selectedForRelease.size === 0 || !releaseVersion.trim()}
                      className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {releaseStatus === 'working' ? 'Releasing…' : 'Release'}
                    </button>
                    {releaseStatus === 'success' && <span className="text-sm text-status-good">Released.</span>}
                    {releaseError && <span className="text-sm text-status-bad">{releaseError}</span>}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-panel p-6">
              <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Released</div>
              <p className="mb-4 text-xs text-muted-500">The permanent record - entries here can no longer be edited.</p>

              {releasedByVersion.length === 0 && <p className="text-xs text-muted-500">Nothing released yet.</p>}

              <div className="flex flex-col gap-6">
                {releasedByVersion.map((group) => (
                  <div key={group.version}>
                    <div className="mb-2 flex items-baseline gap-3 border-b border-border pb-2">
                      <span className="text-lg font-black text-primary">v{group.version}</span>
                      {group.releasedAt && <span className="text-xs text-muted-500">Released {formatDate(group.releasedAt)}</span>}
                    </div>
                    <div className="flex flex-col gap-3">
                      {group.entries.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-border bg-card p-4">
                          <div className="text-sm font-semibold text-primary">{entry.title}</div>
                          <p className="mt-1 text-xs text-muted-400">{entry.description}</p>
                        </div>
                      ))}
                    </div>
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
