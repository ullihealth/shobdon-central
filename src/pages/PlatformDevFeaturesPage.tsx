import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PLATFORM_DEV_FEATURES_URL,
  PLATFORM_DEV_FEATURE_FOLDERS_URL,
  PLATFORM_UPDATES_RELEASE_URL,
  PUBLIC_VERSIONS_URL,
  platformDevFeatureUrl,
} from '../config/publicApi'

type Tab = 'all' | 'reviewed' | 'devlog' | 'bugs'
type SortMode = 'newest' | 'oldest' | 'title-asc' | 'title-desc'
type VersionMode = 'auto' | 'manual'

interface VersionParts {
  major: number
  minor: number
  patch: number
}

// version is free-text typed into this same release form historically
// (see functions/api/_utils/versionSort.ts's own comment) - stripped of
// any leading v/V before parsing, same as that file's own
// parseVersionSegments, so a value like "v1.12.0" reads the same as
// "1.12.0". Not importing that backend util directly - functions/ and
// src/ are separate Vite/Pages-Functions build targets in this repo,
// so a tiny duplicated version of the same handful of lines here stays
// consistent with this codebase's own established per-context-default
// convention (e.g. isValidLat/isValidLon) rather than crossing that
// build boundary for three lines of parsing.
function parseVersionParts(version: string): VersionParts {
  const segments = version
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => {
      const n = parseInt(segment, 10)
      return Number.isFinite(n) ? n : 0
    })
  return { major: segments[0] ?? 0, minor: segments[1] ?? 0, patch: segments[2] ?? 0 }
}

// Odometer-style rollover, confirmed with the platform admin: patch
// past 99 rolls to 00 and bumps minor; minor past 99 (from that same
// overflow) rolls to 00 and bumps major too - Auto mode should never
// get stuck or need a human to intervene just because a release train
// has been running a while, regardless of how many digits deep the
// rollover goes.
function nextVersionParts({ major, minor, patch }: VersionParts): VersionParts {
  let nextPatch = patch + 1
  let nextMinor = minor
  let nextMajor = major
  if (nextPatch > 99) {
    nextPatch = 0
    nextMinor += 1
  }
  if (nextMinor > 99) {
    nextMinor = 0
    nextMajor += 1
  }
  return { major: nextMajor, minor: nextMinor, patch: nextPatch }
}

// Digits only, no length cap - major/minor are "plain integers, no
// padding" per spec, and a release train realistically stays well
// within a few digits without this needing an artificial ceiling.
function sanitiseIntegerInput(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Patch specifically is capped to 0-99 (spec: "always 2 digits,
// zero-padded (00-99)") - digits only AND a hard 2-character length
// cap while typing, separate from the zero-pad-on-blur/display step
// (formatPatchForDisplay below), so the field can never even accept a
// third digit in the first place rather than silently truncating one
// that was already typed.
function sanitisePatchInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 2)
}

function formatPatchForDisplay(raw: string): string {
  const n = Math.min(99, Math.max(0, parseInt(raw, 10) || 0))
  return String(n).padStart(2, '0')
}

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

type BugStatus = 'reported' | 'working' | 'fixed' | 'parked'
const BUG_STATUSES: BugStatus[] = ['reported', 'working', 'fixed', 'parked']

interface BugReportSummary {
  id: string
  title: string
  description: string
  status: BugStatus
  submittedByTenantName: string | null
  createdAt: string
}

// Same labels/colours as BugReportsPage.tsx's own STATUS_LABELS/
// STATUS_STYLES, duplicated locally per this repo's established
// convention of not sharing types/constants across page files (see e.g.
// FeatureRequestsPage.tsx's own STATUS_STYLES, likewise not exported).
const BUG_STATUS_LABELS: Record<BugStatus, string> = {
  reported: 'Reported',
  working: 'Working',
  fixed: 'Fixed',
  parked: 'Parked',
}

const BUG_STATUS_STYLES: Record<BugStatus, string> = {
  reported: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  working: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  fixed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  parked: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
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
  // releaseVersion itself is unchanged - still the one plain string
  // handleRelease/the Release button's disabled check already read.
  // Structured-version-picker round: it's now kept in sync (see the
  // effect below) from either the auto-computed next version or the
  // three manual digit fields, instead of being typed directly - the
  // release request itself, and everything past this state, is
  // completely untouched.
  const [releaseVersion, setReleaseVersion] = useState('')
  const [releasing, setReleasing] = useState(false)
  const [releaseError, setReleaseError] = useState<string | null>(null)

  const [versionMode, setVersionMode] = useState<VersionMode>('auto')
  // The auto-computed NEXT version (latest released + 1 patch, with
  // odometer rollover - see nextVersionParts's own comment) - always
  // kept current regardless of which mode is active, so switching from
  // Manual back to Auto never shows a stale value from whenever this
  // page happened to load.
  const [autoNextVersion, setAutoNextVersion] = useState<VersionParts>({ major: 1, minor: 0, patch: 0 })
  const [latestVersionLoading, setLatestVersionLoading] = useState(true)
  // Only for a genuine fetch failure - zero existing released versions
  // (a brand new deployment with nothing released yet) isn't an error,
  // it falls through to autoNextVersion's own initial state (1.0.00) as
  // the very first version instead.
  const [latestVersionError, setLatestVersionError] = useState<string | null>(null)
  // Manual mode's own three editable fields - digit strings (not
  // numbers) so an input can hold "" while the admin is mid-edit rather
  // than snapping to "0". Seeded from autoNextVersion once the latest-
  // version fetch below resolves, so switching to Manual starts from
  // the natural next version (a useful jumping-off point for a
  // deliberate version bump) rather than blank/0.0.00.
  const [manualMajor, setManualMajor] = useState('1')
  const [manualMinor, setManualMinor] = useState('0')
  const [manualPatch, setManualPatch] = useState('00')

  // Bug report data - powers both the small read-only preview card up
  // top (unchanged) and the new "Bugs" tab below, where status becomes
  // editable. Deliberately its own separate fetch/loading state, not
  // woven into loadAll()/the folder+release workflow above, since bug
  // reports have no folder/eligibility/release concept here. A fetch
  // failure or slowness here shouldn't block the main feature-request
  // workflow from rendering.
  const [bugReports, setBugReports] = useState<BugReportSummary[]>([])
  const [bugReportsLoading, setBugReportsLoading] = useState(true)
  const [updatingBugId, setUpdatingBugId] = useState<string | null>(null)
  // Nice-to-have lightweight filter, scoped to the Bugs tab only - 'all'
  // (the default) shows every status including fixed/parked, matching
  // ALL's own "everything regardless of state" behaviour elsewhere on
  // this page. Purely a client-side view filter, not reflected in the
  // tab's own count badge (that always reflects the true total, same as
  // how "All (N)" counts every entry regardless of any other tab's
  // narrower criteria).
  const [bugStatusFilter, setBugStatusFilter] = useState<'all' | BugStatus>('all')

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

  // Same public, unauthenticated endpoint /versions itself uses
  // (functions/api/public/versions.ts) - already returns every released
  // update sorted DESCENDING by version with a proper numeric
  // comparator, so the latest one is simply the first entry. Fetched
  // once on mount (not tied to the Reviewed tab's own visibility) so
  // Auto mode's pre-fill is already resolved by the time an admin opens
  // it.
  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_VERSIONS_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('bad response'))))
      .then((data: { updates?: { version: string }[] }) => {
        if (cancelled) return
        const latest = data.updates?.[0]?.version
        const next = latest ? nextVersionParts(parseVersionParts(latest)) : { major: 1, minor: 0, patch: 0 }
        setAutoNextVersion(next)
        setManualMajor(String(next.major))
        setManualMinor(String(next.minor))
        setManualPatch(String(next.patch).padStart(2, '0'))
      })
      .catch(() => {
        if (!cancelled) setLatestVersionError("Couldn't determine the latest version - switch to Manual or retry.")
      })
      .finally(() => {
        if (!cancelled) setLatestVersionLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keeps releaseVersion (the one plain string handleRelease/the
  // Release button's disabled check already read, untouched below) in
  // sync with whichever of the two sources is currently active - the
  // rest of the release flow never needs to know a structured picker is
  // what's actually producing this string.
  useEffect(() => {
    const parts: VersionParts =
      versionMode === 'auto'
        ? autoNextVersion
        : {
            major: parseInt(manualMajor, 10) || 0,
            minor: parseInt(manualMinor, 10) || 0,
            patch: Math.min(99, Math.max(0, parseInt(manualPatch, 10) || 0)),
          }
    setReleaseVersion(`${parts.major}.${parts.minor}.${String(parts.patch).padStart(2, '0')}`)
  }, [versionMode, autoNextVersion, manualMajor, manualMinor, manualPatch])

  useEffect(() => {
    fetch('/api/tenant/bug-reports')
      .then((response) => (response.ok ? response.json() : { reports: [] }))
      .then((data) => setBugReports(data.reports ?? []))
      .finally(() => setBugReportsLoading(false))
  }, [])

  // Same PATCH /api/tenant/bug-reports/:id endpoint BugReportsPage.tsx's
  // own handleStatusChange calls (same requireDeveloper gate, nothing
  // new needed server-side) - this page is entirely inside
  // DeveloperLayout's own requireDeveloper route gate already, so unlike
  // that page there's no separate isDeveloper check needed before
  // showing the control itself. Same optimistic-update-then-revert-on-
  // failure shape too.
  async function handleBugStatusChange(report: BugReportSummary, status: BugStatus) {
    setUpdatingBugId(report.id)
    setBugReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status } : r)))
    const response = await fetch(`/api/tenant/bug-reports/${report.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      setBugReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, status: report.status } : r)))
    }
    setUpdatingBugId(null)
  }

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
      bugs: bugReports.length,
    }),
    [entries, bugReports]
  )

  // Reuses the same sortMode state/dropdown the feature-entry list above
  // already has ("matching the existing sort control pattern" - one
  // control governs whichever tab is active, not a second one). No
  // folder filtering (bugs have no folder concept); bugStatusFilter is
  // the one bugs-only narrowing, defaulting to 'all' so fixed/parked
  // stay visible unless a developer deliberately narrows the view.
  const sortedBugReports = useMemo(() => {
    let list = bugStatusFilter === 'all' ? bugReports : bugReports.filter((r) => r.status === bugStatusFilter)
    const sorted = [...list]
    if (sortMode === 'newest') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else if (sortMode === 'oldest') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    else if (sortMode === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else sorted.sort((a, b) => b.title.localeCompare(a.title))
    return sorted
  }, [bugReports, bugStatusFilter, sortMode])

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
      <div className="mx-auto max-w-7xl">
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

        {/* Read-only bug report summary - deliberately separate from the
            feature-request folder/release workflow above/below, since
            bugs have no folder/eligibility/release concept here. Just
            enough to see what's outstanding without leaving this page;
            editing status happens on /bug-reports itself. */}
        <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Bug Reports</div>
            <Link to="/bug-reports" className="text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
              See all →
            </Link>
          </div>
          {bugReportsLoading ? (
            <p className="text-sm text-muted-400">Loading…</p>
          ) : bugReports.length === 0 ? (
            <p className="text-sm text-muted-400">No bug reports yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {bugReports.map((report) => (
                <div
                  key={report.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5"
                >
                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-semibold text-white">{report.title}</div>
                    <div className="mt-1 text-xs text-muted-500">
                      {report.submittedByTenantName ?? 'Unknown tenant'} · {formatDate(report.createdAt)}
                    </div>
                  </div>
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold capitalize ${BUG_STATUS_STYLES[report.status]}`}
                  >
                    {BUG_STATUS_LABELS[report.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <>
            {notice && (
              <div className="mb-6 rounded-lg border border-status-good/40 bg-status-good/10 px-4 py-2 text-sm font-semibold text-status-good">
                {notice}
              </div>
            )}

            {/* Left sidebar + right content, same fixed-width-pane
                convention as PlatformTenantsPage.tsx's own two-pane
                layout (w-72 left pane, flex-1 right) - reused directly
                rather than a new layout mechanism. No lg: breakpoint
                here (unlike that page) - every Developer-section page is
                already desktop-only, so this doesn't need a stacked
                mobile fallback. */}
            <div className="flex min-h-[600px] gap-6">
              <div className="flex w-72 shrink-0 flex-col gap-4">
                <section className="rounded-2xl border border-border bg-panel p-5">
                  <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Folders</div>
                  <div className="mb-4 flex flex-col gap-2">
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
                      className="self-start rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400 disabled:opacity-50"
                    >
                      + Create folder
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedFolderId('all')}
                      className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                        selectedFolderId === 'all'
                          ? 'border border-accent-sky-500 bg-accent-sky-500/10 font-semibold text-white'
                          : 'border border-transparent text-muted-300 hover:bg-slate-800/60'
                      }`}
                    >
                      All ({entries.length})
                    </button>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setSelectedFolderId(folder.id)}
                        className={`truncate rounded-lg px-3 py-2 text-left text-sm transition ${
                          selectedFolderId === folder.id
                            ? 'border border-accent-sky-500 bg-accent-sky-500/10 font-semibold text-white'
                            : 'border border-transparent text-muted-300 hover:bg-slate-800/60'
                        }`}
                      >
                        {folder.name} ({entries.filter((e) => e.folderId === folder.id).length})
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-6">
                <section className="rounded-2xl border border-border bg-panel p-6">
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

                <section className="rounded-2xl border border-border bg-panel p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-2">
                      {(['all', 'reviewed', 'devlog', 'bugs'] as Tab[]).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setActiveTab(tab)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${
                            activeTab === tab ? 'bg-accent-sky-500 text-white' : 'border border-border text-muted-400 hover:text-white'
                          }`}
                        >
                          {tab === 'all' ? 'All' : tab === 'reviewed' ? 'Reviewed' : tab === 'devlog' ? 'Dev Log' : 'Bugs'} (
                          {tab === 'all'
                            ? tabCounts.all
                            : tab === 'reviewed'
                              ? tabCounts.reviewed
                              : tab === 'devlog'
                                ? tabCounts.devlog
                                : tabCounts.bugs}
                          )
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
                        {/* Auto/Manual toggle - same active/inactive
                            visual language as the All/Reviewed/Dev Log/
                            Bugs tab buttons above, just smaller, so it
                            reads as a segmented control rather than a
                            second unrelated tab row. */}
                        <div className="flex overflow-hidden rounded-lg border border-slate-700">
                          {(['auto', 'manual'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setVersionMode(mode)}
                              className={`px-2.5 py-1.5 text-xs font-bold uppercase tracking-widest ${
                                versionMode === mode ? 'bg-accent-sky-500 text-white' : 'bg-slate-900/80 text-muted-400 hover:text-white'
                              }`}
                            >
                              {mode === 'auto' ? 'Auto' : 'Manual'}
                            </button>
                          ))}
                        </div>

                        {/* Structured version picker - fixed "V" prefix
                            and "." separators the admin can't edit or
                            delete, so the result is always exactly
                            V<major>.<minor>.<patch>, never malformed.
                            Auto: all three boxes disabled, showing
                            autoNextVersion (latest released + 1 patch,
                            with odometer rollover into minor/major - see
                            nextVersionParts's own comment). Manual: same
                            three boxes, unlocked, format-enforced via
                            sanitiseIntegerInput/sanitisePatchInput on
                            every keystroke rather than validated after
                            the fact. */}
                        <div className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white">
                          <span className="font-bold text-muted-400">V</span>
                          <input
                            aria-label="Major version"
                            value={versionMode === 'auto' ? String(autoNextVersion.major) : manualMajor}
                            onChange={(event) => setManualMajor(sanitiseIntegerInput(event.target.value))}
                            disabled={versionMode === 'auto'}
                            inputMode="numeric"
                            className="w-10 bg-transparent text-center outline-none disabled:text-muted-400"
                          />
                          <span className="text-muted-400">.</span>
                          <input
                            aria-label="Minor version"
                            value={versionMode === 'auto' ? String(autoNextVersion.minor) : manualMinor}
                            onChange={(event) => setManualMinor(sanitiseIntegerInput(event.target.value))}
                            disabled={versionMode === 'auto'}
                            inputMode="numeric"
                            className="w-10 bg-transparent text-center outline-none disabled:text-muted-400"
                          />
                          <span className="text-muted-400">.</span>
                          <input
                            aria-label="Patch version"
                            value={versionMode === 'auto' ? String(autoNextVersion.patch).padStart(2, '0') : manualPatch}
                            onChange={(event) => setManualPatch(sanitisePatchInput(event.target.value))}
                            onBlur={(event) => setManualPatch(formatPatchForDisplay(event.target.value))}
                            disabled={versionMode === 'auto'}
                            inputMode="numeric"
                            className="w-10 bg-transparent text-center outline-none disabled:text-muted-400"
                          />
                        </div>

                        {versionMode === 'auto' && latestVersionLoading && (
                          <span className="text-xs text-muted-400">Loading latest version…</span>
                        )}
                        {versionMode === 'auto' && latestVersionError && (
                          <span className="text-xs text-status-bad">{latestVersionError}</span>
                        )}

                        <button
                          type="button"
                          onClick={handleRelease}
                          disabled={
                            releasing ||
                            selectedForRelease.size === 0 ||
                            !releaseVersion.trim() ||
                            (versionMode === 'auto' && (latestVersionLoading || !!latestVersionError))
                          }
                          className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {releasing ? 'Releasing…' : 'Release'}
                        </button>
                        {releaseError && <span className="text-sm text-status-bad">{releaseError}</span>}
                      </div>
                    </div>
                  )}

                  {activeTab !== 'bugs' && (
                  <>
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
                  </>
                  )}

                  {activeTab === 'bugs' && (
                  <>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {(['all', ...BUG_STATUSES] as ('all' | BugStatus)[]).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setBugStatusFilter(filter)}
                        className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition ${
                          bugStatusFilter === filter
                            ? 'bg-accent-sky-500 text-white'
                            : 'border border-border text-muted-500 hover:text-white'
                        }`}
                      >
                        {filter === 'all' ? 'All' : BUG_STATUS_LABELS[filter]}
                      </button>
                    ))}
                  </div>

                  {sortedBugReports.length === 0 && <p className="text-xs text-muted-500">Nothing here yet.</p>}

                  <div className="flex flex-col gap-3">
                    {sortedBugReports.map((report) => (
                      <div key={report.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-[220px] flex-1">
                            <div className="text-sm font-semibold text-white">{report.title}</div>
                            <p className="mt-1 text-sm text-muted-400">{report.description}</p>
                            <div className="mt-2 text-xs text-muted-500">
                              {report.submittedByTenantName ?? 'Unknown tenant'} · {formatDate(report.createdAt)}
                            </div>
                          </div>
                          <select
                            value={report.status}
                            disabled={updatingBugId === report.id}
                            onChange={(event) => handleBugStatusChange(report, event.target.value as BugStatus)}
                            className={`rounded-lg border px-2 py-1 text-xs font-semibold focus:border-sky-500 focus:outline-none disabled:opacity-50 ${BUG_STATUS_STYLES[report.status]}`}
                          >
                            {BUG_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {BUG_STATUS_LABELS[status]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
