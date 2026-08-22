import { useEffect, useMemo, useState } from 'react'
import { LabelPill } from '../components/admin/LabelPill'
import { ColorPicker } from '../components/admin/ColorPicker'

const IP_LABELS_URL = '/api/platform/ip-labels'

interface IpLabel {
  id: number
  ipAddress: string
  groupName: string
  note: string | null
  // Migration 0058 - fixed-palette key; see src/utils/labelColors.ts.
  color: string | null
  createdAt: string
  updatedAt: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Secondary management view for the global IP directory (migration
// 0057) - the primary workflow is labeling inline from the Visit Log
// (a row's click-to-expand has its own "Label this IP" action), so
// this page exists for the follow-up work that workflow doesn't cover:
// seeing everything grouped at a glance, fixing a typo'd group name,
// pre-labeling an IP before it's even shown up in the log yet, or
// removing a label entirely.
export default function IpDirectoryPage(): JSX.Element {
  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'IP Directory — Airfield Central'
  }, [])

  const [labels, setLabels] = useState<IpLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [newIp, setNewIp] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newColor, setNewColor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  function loadLabels() {
    setLoading(true)
    return fetch(IP_LABELS_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) setLabels(data.labels ?? [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadLabels()
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<string, IpLabel[]>()
    for (const l of labels) {
      const list = map.get(l.groupName) ?? []
      list.push(l)
      map.set(l.groupName, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [labels])

  const existingGroupNames = useMemo(() => Array.from(new Set(labels.map((l) => l.groupName))).sort(), [labels])

  async function handleAdd() {
    if (!newIp.trim() || !newGroup.trim()) return
    setSaving(true)
    try {
      await fetch(IP_LABELS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ipAddress: newIp.trim(),
          groupName: newGroup.trim(),
          note: newNote.trim() || undefined,
          color: newColor,
        }),
      })
      setNewIp('')
      setNewGroup('')
      setNewNote('')
      setNewColor(null)
      await loadLabels()
    } finally {
      setSaving(false)
    }
  }

  // Colour-only edit - saves immediately on pick (no separate button),
  // same "single fast action" spirit as the rest of this feature. Reuses
  // the same upsert endpoint with this row's existing ip/group/note
  // unchanged, only color different.
  async function handleChangeColor(label: IpLabel, color: string | null) {
    setBusyId(label.id)
    try {
      await fetch(IP_LABELS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ipAddress: label.ipAddress, groupName: label.groupName, note: label.note ?? undefined, color }),
      })
      await loadLabels()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(label: IpLabel) {
    setBusyId(label.id)
    try {
      await fetch(`${IP_LABELS_URL}/${label.id}`, { method: 'DELETE' })
      await loadLabels()
    } finally {
      setBusyId(null)
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
      <div className="mx-auto max-w-[1400px]">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · IP Directory</h1>
        <p className="mb-6 max-w-3xl text-sm text-muted-400">
          Global labels for any IP Jeff recognizes - his own machine, a VPN, a specific tenant's real display -
          independent of the tenant-scoped uptime confirmation on{' '}
          <a href="/platform/known-devices" className="text-accent-sky-400 hover:underline">
            Known Devices
          </a>
          . The usual way to add one is inline from the{' '}
          <a href="/platform/visits" className="text-accent-sky-400 hover:underline">
            Visit Log
          </a>{' '}
          itself; this page is for reviewing and cleaning up what's already labeled.
        </p>

        <div className="mb-8 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-panel p-4">
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            IP address
            <input
              type="text"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              placeholder="185.69.144.84"
              className="w-48 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            Group
            <input
              type="text"
              list="ip-directory-group-names"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Jeff's Mac"
              className="w-48 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-400">
            Note (optional)
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Optional context"
              className="w-64 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted-400">
            Colour
            <div className="flex h-[38px] items-center">
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newIp.trim() || !newGroup.trim()}
            className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Add label'}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-500">No IPs labeled yet.</p>
        ) : (
          <div className="space-y-6">
            {grouped.map(([groupName, ips]) => (
              <div key={groupName} className="overflow-hidden rounded-2xl border border-border bg-panel">
                <div className="flex items-center gap-2 border-b border-border bg-white/5 px-4 py-2">
                  <LabelPill groupName={groupName} color={ips[0]?.color ?? null} className="text-sm" />
                  <span className="text-xs text-muted-500">({ips.length})</span>
                </div>
                <table className="w-full text-left text-sm">
                  <tbody>
                    {ips.map((l) => (
                      <tr key={l.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 text-xs text-muted-300">{l.ipAddress}</td>
                        <td className="px-4 py-3 text-xs text-muted-500">{l.note ?? ''}</td>
                        <td className="px-4 py-3">
                          <ColorPicker
                            value={l.color}
                            onChange={(color) => handleChangeColor(l, color)}
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-600">Updated {formatDate(l.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={busyId === l.id}
                            onClick={() => handleDelete(l)}
                            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-status-bad hover:border-status-bad disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
      <datalist id="ip-directory-group-names">
        {existingGroupNames.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>
    </div>
  )
}
