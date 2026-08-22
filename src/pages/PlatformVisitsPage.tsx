import { Fragment, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { LabelPill } from '../components/admin/LabelPill'
import { IpLabelEditor } from '../components/admin/IpLabelEditor'
import { resolveLabelColor } from '../utils/labelColors'

const VISITS_URL = '/api/platform/visits'
const VISITS_EXPORT_URL = '/api/platform/visits/export'
const IP_LABELS_URL = '/api/platform/ip-labels'
const MY_IP_URL = '/api/platform/my-ip'

// The hide-set is the one piece of this page's filter state that's
// meant to be a standing preference (labels Jeff never wants to see
// again, e.g. his own machine) rather than a one-off query - so it's
// the only filter persisted across reloads. unlabeledOnly/soloGroups
// are both deliberately session-only (see their own state comments).
const HIDE_GROUPS_STORAGE_KEY = 'platformVisits.hideGroups'

function loadPersistedHideGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDE_GROUPS_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

interface Visit {
  id: number
  tenantId: number
  tenantName: string
  tenantSlug: string
  displaySlug: string
  visitedAt: string
  ipAddress: string | null
  userAgent: string | null
  // Migration 0055 - Cloudflare-native geolocation, captured going
  // forward only. NULL on every row logged before that migration; no
  // backfill exists or is planned (see the migration's own comment).
  geoCountry: string | null
  geoRegion: string | null
  geoCity: string | null
  geoLatitude: string | null
  geoLongitude: string | null
  // Migration 0057 - the global IP directory (ip_labels), NOT the same
  // thing as tenant_known_devices' per-tenant uptime confirmation. Any
  // IP Jeff recognizes can carry a label here regardless of which
  // tenant it appeared under.
  labelGroup: string | null
  // Migration 0058 - fixed-palette key; see src/utils/labelColors.ts.
  labelColor: string | null
}

interface IpLabel {
  id: number
  ipAddress: string
  groupName: string
  note: string | null
  color: string | null
}

// "Leominster, Herefordshire, GB" - city/region are frequently absent
// even when country is present (Cloudflare's own geolocation coverage
// varies by request), so each part is included only if actually set,
// rather than rendering literal "null" or leaving stray ", " gaps.
function formatGeoSummary(visit: Visit): string | null {
  const parts = [visit.geoCity, visit.geoRegion, visit.geoCountry].filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(', ') : null
}

type SortField = 'visitedAt' | 'ipAddress'
type SortDirection = 'asc' | 'desc'

function formatVisitedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// One line per row, tab-separated - pastes cleanly into a spreadsheet
// (Sheets/Excel both split on tab) while still being plain readable
// text if pasted somewhere that isn't. Includes a header row so a
// paste destination that DOES respect it gets labelled columns.
function visitsToClipboardText(rows: Visit[]): string {
  const header = ['Time', 'Tenant', 'Display', 'IP address', 'User agent', 'Label'].join('\t')
  const lines = rows.map((v) =>
    [
      formatVisitedAt(v.visitedAt),
      `${v.tenantName} (${v.tenantSlug})`,
      v.displaySlug,
      v.ipAddress ?? '—',
      v.userAgent ?? '—',
      v.labelGroup ?? '',
    ].join('\t')
  )
  return [header, ...lines].join('\n')
}

// Same hand-rolled eye/eye-slash SVGs as PasswordField.tsx (no icon
// library in this app - see that component's own comment on why) - kept
// as two small local components rather than importing PasswordField's
// icons directly, since those live inline in that file rather than
// being exported.
function EyeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 1 11.5s4 7 11 7a9.26 9.26 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// Backs the Platform Admin "Visit Log" nav entry - a plain,
// reverse-chronological view over display_visits (migration 0041), the
// per-visit log written by functions/api/public/heartbeat.ts on every
// ~30-minute heartbeat ping (or immediately on IP/user-agent change).
// Deliberately just a filterable list, no charts/aggregates - the
// questions this answers ("was this screen on around 9am", "what IPs
// have hit this URL lately") are both answered directly by scanning
// rows, not by a summary view.
export default function PlatformVisitsPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Visit Log — Airfield Central'
  }, [])

  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [tenantFilter, setTenantFilter] = useState('')
  const [slugFilter, setSlugFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('visitedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [hideGroups, setHideGroups] = useState<Set<string>>(loadPersistedHideGroups)
  const [unlabeledOnly, setUnlabeledOnly] = useState(false)
  // Visit Log sidebar's "solo" set - deliberately NOT persisted (unlike
  // hideGroups above). This is a quick "is this one alive right now"
  // check, not a standing preference, so every fresh page load starts
  // back at "show everything" regardless of what was soloed last time.
  const [soloGroups, setSoloGroups] = useState<Set<string>>(new Set())
  // Type-to-filter over the sidebar's own label list - display-only,
  // never sent to the server (narrowing which labels are visible/
  // clickable in the sidebar, not which visit rows are shown).
  const [labelSearch, setLabelSearch] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(HIDE_GROUPS_STORAGE_KEY, JSON.stringify(Array.from(hideGroups)))
    } catch {
      // Storage can fail (private browsing, quota) - the hide filter
      // still works for this session via component state either way,
      // it just won't survive a reload. Not worth surfacing as an error
      // for a convenience feature.
    }
  }, [hideGroups])

  // "This is my device" - detects the caller's own IP (server-side, via
  // the same CF-Connecting-IP header heartbeat.ts logs) and opens the
  // SAME IpLabelEditor the per-row expand panel uses below, pre-filled
  // with whatever this IP is already labeled as (if anything). null
  // means the panel is closed; set means "show it, editing this IP."
  const [myIpTarget, setMyIpTarget] = useState<{ ipAddress: string; groupName: string | null; color: string | null } | null>(null)
  const [detectingIp, setDetectingIp] = useState(false)
  const [detectIpError, setDetectIpError] = useState<string | null>(null)

  // Tenant slug -> id, accumulated (never shrunk) across every response
  // this page has seen so far - needed because tenantFilter is a slug
  // (readable in the URL-less UI, matches how the display-slug filter
  // already works) but the server-side filter takes tenant_id. Built up
  // rather than fetched from a dedicated tenants endpoint so this page
  // still works with zero extra requests on the common case (no filter
  // picked yet).
  const [knownTenants, setKnownTenants] = useState<Map<string, { id: number; name: string }>>(new Map())
  const [knownSlugs, setKnownSlugs] = useState<Set<string>>(new Set())

  // All existing group names, fetched once - backs the sidebar's own
  // list, the "hide these groups" filtering, and every IpLabelEditor's
  // dropdown (both the per-row one below and the "This is my device"
  // one) so a device gets assigned to a real existing group rather than
  // a typo'd near-duplicate of one.
  const [allLabels, setAllLabels] = useState<IpLabel[]>([])
  const allGroupNames = useMemo(() => Array.from(new Set(allLabels.map((l) => l.groupName))).sort(), [allLabels])

  // A group's colour lives per-IP-row (migration 0058), but the "Hide"
  // filter pills operate at the group level - this picks one
  // representative colour per group_name (preferring an explicit one
  // over a not-yet-set null) so the pill matches whatever colour Jeff
  // actually sees on that group's individual rows.
  const groupColors = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const l of allLabels) {
      const existing = map.get(l.groupName)
      if (existing === undefined || (!existing && l.color)) {
        map.set(l.groupName, l.color)
      }
    }
    return map
  }, [allLabels])

  function loadLabels() {
    return fetch(IP_LABELS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setAllLabels(data.labels ?? [])
      })
  }

  useEffect(() => {
    loadLabels()
  }, [])

  // display_visits is well beyond the backing endpoint's single-response
  // cap (see that endpoint's own MAX_ROWS comment - confirmed against
  // production, 2026-07: 5,029 total rows, 4,998 of them Shobdon's own),
  // so an unfiltered fetch only ever shows a thin recent slice. Tenant/
  // display/date-range/label filters are all sent to the server (not
  // applied client-side against that slice) specifically so narrowing
  // actually reaches rows outside that window.
  // Pulled out of the effect below so a manual "Refresh" click can call
  // the exact same fetch on demand - e.g. labels added in another tab/
  // by another admin since this page loaded, which the client-side
  // label-save patch (handleSaveLabel below) has no way to know about
  // on its own.
  function loadVisits() {
    setLoading(true)
    const params = new URLSearchParams()
    const tenantId = tenantFilter ? knownTenants.get(tenantFilter)?.id : undefined
    if (tenantId !== undefined) params.set('tenantId', String(tenantId))
    if (slugFilter) params.set('slug', slugFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    if (hideGroups.size > 0) params.set('hideGroups', Array.from(hideGroups).join(','))
    if (unlabeledOnly) params.set('unlabeledOnly', 'true')
    if (soloGroups.size > 0) params.set('onlyGroups', Array.from(soloGroups).join(','))
    const query = params.toString()

    return fetch(query ? `${VISITS_URL}?${query}` : VISITS_URL)
      .then((response) => {
        if (response.status === 403 || response.status === 401) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (!data) return
        const rows: Visit[] = data.visits ?? []
        setVisits(rows)
        setKnownTenants((prev) => {
          const next = new Map(prev)
          for (const v of rows) next.set(v.tenantSlug, { id: v.tenantId, name: v.tenantName })
          return next
        })
        setKnownSlugs((prev) => {
          const next = new Set(prev)
          for (const v of rows) next.add(v.displaySlug)
          return next
        })
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadVisits()
    // tenantFilter's server-side lookup depends on knownTenants, but
    // knownTenants is only ever added to (never removed from) by this
    // same effect's own responses, so including it here would refetch
    // on every response - it's read via a ref-like snapshot at call
    // time instead (the .get() above), deliberately left out of the
    // dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantFilter, slugFilter, dateFrom, dateTo, hideGroups, unlabeledOnly, soloGroups])

  const tenantOptions = useMemo(() => Array.from(knownTenants.keys()).sort(), [knownTenants])
  const slugOptions = useMemo(() => Array.from(knownSlugs).sort(), [knownSlugs])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection(field === 'visitedAt' ? 'desc' : 'asc')
    }
  }

  function toggleHideGroup(group: string) {
    setHideGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  // Plain click solos JUST this label - replacing whatever the solo set
  // currently holds - except when this label is ALREADY the sole active
  // solo, in which case it toggles back off (per spec: "click it again
  // -> back to showing everything"). Shift/cmd/ctrl-click instead adds
  // this label to (or, symmetrically, removes it from) the existing
  // solo set, so a multi-label solo can be built up incrementally and
  // individual labels can be dropped from it again without clearing the
  // whole set and starting over.
  function handleLabelNameClick(group: string, event: ReactMouseEvent) {
    const additive = event.shiftKey || event.metaKey || event.ctrlKey
    setSoloGroups((prev) => {
      if (additive) {
        const next = new Set(prev)
        if (next.has(group)) next.delete(group)
        else next.add(group)
        return next
      }
      if (prev.size === 1 && prev.has(group)) return new Set()
      return new Set([group])
    })
  }

  const visibleGroupNames = useMemo(() => {
    const query = labelSearch.trim().toLowerCase()
    return query ? allGroupNames.filter((group) => group.toLowerCase().includes(query)) : allGroupNames
  }, [allGroupNames, labelSearch])

  // Sort is purely client-side over whatever the server just returned
  // (already the correctly-filtered set, up to MAX_ROWS) - re-ordering
  // an in-memory array needs no round trip.
  const filtered = useMemo(() => {
    const rows = [...visits]
    rows.sort((a, b) => {
      let result: number
      if (sortField === 'visitedAt') {
        result = a.visitedAt.localeCompare(b.visitedAt)
      } else {
        // Nulls last regardless of direction - an unknown IP shouldn't
        // visually dominate either end of a sorted list.
        if (a.ipAddress === null && b.ipAddress === null) result = 0
        else if (a.ipAddress === null) return 1
        else if (b.ipAddress === null) return -1
        else result = a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true })
      }
      return sortDirection === 'asc' ? result : -result
    })
    return rows
  }, [visits, sortField, sortDirection])

  const allVisibleSelected = filtered.length > 0 && filtered.every((v) => selectedIds.has(v.id))

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(filtered.map((v) => v.id)))
  }

  function toggleRowSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Copies the selected rows if any are checked, otherwise every
  // currently filtered/sorted row - so the common "just grab everything
  // I'm looking at" case needs no selection step first, while a
  // deliberate subset still works via the checkboxes.
  async function handleCopy() {
    const rowsToCopy = selectedIds.size > 0 ? filtered.filter((v) => selectedIds.has(v.id)) : filtered
    await navigator.clipboard.writeText(visitsToClipboardText(rowsToCopy))
    setCopyStatus('copied')
    setTimeout(() => setCopyStatus('idle'), 1500)
  }

  // Deliberately reuses whatever the visible tenant/display/date/label
  // filters are already set to, rather than a separate scope picker -
  // those filters already ARE the scope, and duplicating them as a
  // second control would just be two ways to say the same thing. Plain
  // navigation (not fetch+blob) - the export endpoint's own
  // Content-Disposition: attachment header triggers the browser's
  // download, and a same-origin navigation carries the session cookie
  // the endpoint needs automatically.
  function handleExport() {
    const params = new URLSearchParams()
    const tenantId = tenantFilter ? knownTenants.get(tenantFilter)?.id : undefined
    if (tenantId !== undefined) params.set('tenantId', String(tenantId))
    if (slugFilter) params.set('slug', slugFilter)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    if (hideGroups.size > 0) params.set('hideGroups', Array.from(hideGroups).join(','))
    if (unlabeledOnly) params.set('unlabeledOnly', 'true')
    if (soloGroups.size > 0) params.set('onlyGroups', Array.from(soloGroups).join(','))
    const query = params.toString()
    window.location.href = query ? `${VISITS_EXPORT_URL}?${query}` : VISITS_EXPORT_URL
  }

  // Shared by both IpLabelEditor mount points (the per-row expand panel
  // and the "This is my device" panel below) - a label is per-IP, not
  // per-visit-row or per-entry-point, so saving one updates every
  // currently-loaded row sharing this IP immediately (not just whichever
  // triggered it) rather than requiring a full refetch, and refreshes
  // the sidebar's own label list either way.
  async function handleLabelSaved(ipAddress: string, groupName: string, color: string | null) {
    setVisits((prev) => prev.map((v) => (v.ipAddress === ipAddress ? { ...v, labelGroup: groupName, labelColor: color } : v)))
    await loadLabels()
    setExpandedRowId(null)
    setMyIpTarget(null)
  }

  // Server-side detection (CF-Connecting-IP, same header heartbeat.ts
  // logs) rather than a third-party "what's my IP" service - guarantees
  // the detected value matches exactly what ends up in display_visits,
  // and never writes anything itself; it only opens the editor,
  // pre-filled with whatever this IP is already labeled as (if
  // anything) via a lookup against the labels already loaded for the
  // sidebar - Jeff still has to hit Save.
  async function handleDetectMyIp() {
    setDetectingIp(true)
    setDetectIpError(null)
    try {
      const response = await fetch(MY_IP_URL)
      if (!response.ok) {
        setDetectIpError("Couldn't detect your IP - please try again.")
        return
      }
      const data = await response.json()
      if (typeof data?.ip !== 'string' || !data.ip) {
        setDetectIpError('No IP detected for this request.')
        return
      }
      const existing = allLabels.find((l) => l.ipAddress === data.ip)
      setMyIpTarget({ ipAddress: data.ip, groupName: existing?.groupName ?? null, color: existing?.color ?? null })
    } catch {
      setDetectIpError("Couldn't detect your IP - please try again.")
    } finally {
      setDetectingIp(false)
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-[1900px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Visit Log</h1>
        <p className="mb-4 max-w-2xl text-sm text-muted-400">
          Every logged display visit, across every tenant. A row is written on every ~30-minute heartbeat ping (or
          immediately if the IP/user-agent changes). Rows older than 30 days are pruned automatically. Click a row to
          see its captured location and label it.
        </p>

        <div className="flex gap-6">
          <aside className="w-64 shrink-0">
            <div className="sticky top-6 rounded-xl border border-border bg-panel/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-500">Labels</span>
                {soloGroups.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSoloGroups(new Set())}
                    className="text-xs text-accent-sky-400 hover:underline"
                  >
                    Show all
                  </button>
                )}
              </div>
              {allGroupNames.length === 0 ? (
                <p className="text-xs text-muted-500">No labels yet.</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={labelSearch}
                    onChange={(event) => setLabelSearch(event.target.value)}
                    placeholder="Filter labels…"
                    className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                  />
                  <div className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto">
                    {visibleGroupNames.map((group) => {
                      const isHidden = hideGroups.has(group)
                      const isSolo = soloGroups.has(group)
                      const entry = resolveLabelColor(groupColors.get(group), group)
                      return (
                        <div
                          key={group}
                          className={`flex items-center gap-1 rounded-lg px-1.5 py-1.5 ${
                            isSolo && !isHidden ? 'bg-accent-sky-500/15' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(event) => handleLabelNameClick(group, event)}
                            title={
                              isHidden
                                ? `${group} (hidden - hiding always wins over solo)`
                                : `Click to solo · Shift/Cmd/Ctrl-click to add to solo set`
                            }
                            className={`min-w-0 flex-1 truncate text-left text-xs ${
                              isHidden
                                ? 'text-muted-600 line-through'
                                : isSolo
                                  ? 'font-semibold text-accent-sky-400'
                                  : entry.pillClass.split(' ').find((c) => c.startsWith('text-')) || 'text-muted-200'
                            }`}
                          >
                            {group}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleHideGroup(group)}
                            aria-label={isHidden ? `Show ${group}` : `Hide ${group}`}
                            title={isHidden ? 'Hidden - click to show' : 'Click to hide'}
                            className={`shrink-0 rounded p-1 hover:bg-white/10 ${isHidden ? 'text-status-bad' : 'text-muted-500'}`}
                          >
                            {isHidden ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </div>
                      )
                    })}
                    {visibleGroupNames.length === 0 && (
                      <p className="px-1.5 py-1.5 text-xs text-muted-500">No labels match &ldquo;{labelSearch}&rdquo;.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>

          <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <select
            value={tenantFilter}
            onChange={(event) => setTenantFilter(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All tenants</option>
            {tenantOptions.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
          <select
            value={slugFilter}
            onChange={(event) => setSlugFilter(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All displays</option>
            {slugOptions.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-400">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-400">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom('')
                setDateTo('')
              }}
              className="text-xs text-accent-sky-400 hover:underline"
            >
              Clear dates
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            disabled={filtered.length === 0}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500 disabled:opacity-40"
          >
            {copyStatus === 'copied'
              ? 'Copied!'
              : selectedIds.size > 0
                ? `Copy ${selectedIds.size} selected`
                : 'Copy all visible'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500 disabled:opacity-40"
            title="Exports every matching row for the current filters - not just what's rendered on screen"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={loadVisits}
            disabled={loading}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-400 hover:border-slate-500 disabled:opacity-40"
            title="Pull fresh data from the server for the current filters - e.g. if labels were added elsewhere since this page loaded"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={handleDetectMyIp}
            disabled={detectingIp}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-sky-500 disabled:opacity-40"
            title="Detects your current request IP server-side (the same header the heartbeat/visit log itself uses) and opens the label editor for it - nothing is saved until you hit Save"
          >
            {detectingIp ? 'Detecting…' : 'This is my device'}
          </button>
          <span className="text-xs text-muted-500">
            {filtered.length} visit{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {detectIpError && <p className="mb-4 text-xs text-status-bad">{detectIpError}</p>}

        {myIpTarget && (
          <div className="mb-6 rounded-xl border border-accent-sky-500/40 bg-accent-sky-500/5 p-3">
            <div className="mb-2 text-xs">
              <span className="font-semibold uppercase tracking-widest text-muted-400">Detected IP: </span>
              <span className="font-mono text-primary">{myIpTarget.ipAddress}</span>
              {myIpTarget.groupName && <span className="ml-2 text-muted-500">(currently labeled)</span>}
            </div>
            <IpLabelEditor
              key={myIpTarget.ipAddress}
              ipAddress={myIpTarget.ipAddress}
              initialGroupName={myIpTarget.groupName}
              initialColor={myIpTarget.color}
              allGroupNames={allGroupNames}
              onSaved={(groupName, color) => handleLabelSaved(myIpTarget.ipAddress, groupName, color)}
              onCancel={() => setMyIpTarget(null)}
            />
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel/60 p-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-500">Label filter:</span>
          <label className="flex items-center gap-2 text-xs text-muted-300">
            <input
              type="checkbox"
              checked={unlabeledOnly}
              onChange={(e) => setUnlabeledOnly(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Unlabeled only
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all visible rows"
                      className="h-3.5 w-3.5"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('visitedAt')}
                      className="flex items-center gap-1 uppercase tracking-widest hover:text-primary"
                    >
                      Time
                      {sortField === 'visitedAt' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Display</th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('ipAddress')}
                      className="flex items-center gap-1 uppercase tracking-widest hover:text-primary"
                    >
                      IP address
                      {sortField === 'ipAddress' && <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">User agent</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((visit) => {
                  const isExpanded = expandedRowId === visit.id
                  const isSelected = selectedIds.has(visit.id)
                  const geoSummary = formatGeoSummary(visit)
                  return (
                    <Fragment key={visit.id}>
                      <tr
                        className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-white/5 ${
                          isSelected ? 'bg-sky-500/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRowSelected(visit.id)}
                            aria-label={`Select visit ${visit.id}`}
                            className="h-3.5 w-3.5"
                          />
                        </td>
                        <td
                          className="px-4 py-3 text-xs text-muted-400"
                          onClick={() => setExpandedRowId(isExpanded ? null : visit.id)}
                        >
                          {formatVisitedAt(visit.visitedAt)}
                        </td>
                        <td className="px-4 py-3" onClick={() => setExpandedRowId(isExpanded ? null : visit.id)}>
                          <div className="font-semibold">{visit.tenantName}</div>
                          <div className="text-xs text-muted-500">{visit.tenantSlug}</div>
                        </td>
                        <td
                          className="px-4 py-3 text-xs text-muted-400"
                          onClick={() => setExpandedRowId(isExpanded ? null : visit.id)}
                        >
                          {visit.displaySlug}
                        </td>
                        <td
                          className="px-4 py-3 text-xs text-muted-400"
                          onClick={() => setExpandedRowId(isExpanded ? null : visit.id)}
                        >
                          {visit.ipAddress ?? '—'}
                        </td>
                        <td
                          className="px-4 py-3 text-xs"
                          onClick={() => setExpandedRowId(isExpanded ? null : visit.id)}
                        >
                          {visit.labelGroup ? (
                            <LabelPill groupName={visit.labelGroup} color={visit.labelColor} />
                          ) : (
                            <span className="text-muted-600">—</span>
                          )}
                        </td>
                        <td
                          className="max-w-xs truncate px-4 py-3 text-xs text-muted-500"
                          title={visit.userAgent ?? ''}
                          onClick={() => setExpandedRowId(isExpanded ? null : visit.id)}
                        >
                          {visit.userAgent ?? '—'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-border/60 bg-white/5 last:border-0">
                          <td colSpan={7} className="px-4 py-3 text-xs">
                            <div className="mb-2">
                              <span className="font-semibold uppercase tracking-widest text-muted-400">Location: </span>
                              {geoSummary ? (
                                <span className="text-muted-300">
                                  {geoSummary}
                                  {visit.geoLatitude && visit.geoLongitude && (
                                    <span className="ml-2 text-muted-500">
                                      ({visit.geoLatitude}, {visit.geoLongitude})
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="italic text-muted-500">
                                  Not available (logged before geolocation was added)
                                </span>
                              )}
                            </div>
                            {visit.ipAddress && (
                              <div onClick={(e) => e.stopPropagation()}>
                                <span className="mb-1 block font-semibold uppercase tracking-widest text-muted-400">
                                  Label this IP:
                                </span>
                                <IpLabelEditor
                                  key={visit.ipAddress}
                                  ipAddress={visit.ipAddress}
                                  initialGroupName={visit.labelGroup}
                                  initialColor={visit.labelColor}
                                  allGroupNames={allGroupNames}
                                  onSaved={(groupName, color) => handleLabelSaved(visit.ipAddress as string, groupName, color)}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-sm text-muted-500" colSpan={7}>
                      {tenantFilter ||
                      slugFilter ||
                      dateFrom ||
                      dateTo ||
                      hideGroups.size > 0 ||
                      unlabeledOnly ||
                      soloGroups.size > 0
                        ? 'No visits match the current filters.'
                        : 'No visits logged yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  )
}
