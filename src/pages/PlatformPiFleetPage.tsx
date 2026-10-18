import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PilotCollapsibleSection from '../components/pilot/PilotCollapsibleSection'

const PI_UNITS_URL = '/api/platform/pi-units'

const STATUS_OPTIONS = ['active', 'spare', 'faulty', 'retired'] as const
type Status = (typeof STATUS_OPTIONS)[number]

const STATUS_COLORS: Record<Status, string> = {
  active: 'bg-status-good',
  spare: 'bg-accent-sky-400',
  faulty: 'bg-status-bad',
  retired: 'bg-muted-500',
}

interface PiUnitNote {
  id: number
  noteText: string
  createdAt: string
}

interface PiUnit {
  id: number
  serialNumber: string
  tenantName: string | null
  physicalAddress: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  wifiNetworkName: string | null
  dateIssued: string | null
  hostname: string | null
  dashboardUrl: string | null
  masterImageVersion: string | null
  imageSourceLink: string | null
  status: string
  createdAt: string
  updatedAt: string
  notes: PiUnitNote[]
  // TV wake/sleep schedule round (migration 0114).
  tvScheduleEnabled: boolean
  tvSchedule: TvSchedule | null
  tvScheduleOverrideState: 'wake' | 'sleep' | null
  tvScheduleOverrideUntil: string | null
  tvScheduleOverrideActive: boolean
  tvScheduleLastSeenAt: string | null
  tvScheduleLastCommand: string | null
  tvScheduleLastCommandAt: string | null
  tvScheduleLastError: string | null
}

const WEEKDAYS: { key: keyof TvSchedule; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

interface TvDaySchedule {
  wake: string
  sleep: string
  off: boolean
}

type TvSchedule = Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', TvDaySchedule>

function defaultTvSchedule(): TvSchedule {
  const day: TvDaySchedule = { wake: '07:00', sleep: '22:00', off: false }
  return { mon: { ...day }, tue: { ...day }, wed: { ...day }, thu: { ...day }, fri: { ...day }, sat: { ...day }, sun: { ...day } }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// TV wake/sleep schedule round - "Last seen"/"Last command" need
// second-level precision and an explicit timezone name (e.g. "18 Oct
// 2026, 11:52:02 BST"), unlike every other timestamp on this page -
// explicit `timeZone: 'Europe/London'` so this is correct regardless of
// which timezone the viewing admin's own browser happens to be in, same
// reasoning as the box's own schedule logic using zoneinfo Europe/London
// explicitly rather than trusting an ambient timezone.
function formatDateTimeWithSeconds(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/London', timeZoneName: 'short',
  })
}

// Generic single-field text editor - save on blur (not per-keystroke),
// matching this app's established "local state updates synchronously,
// the network write fires on blur/debounce" convention elsewhere (e.g.
// MediaManagerPage.tsx's own per-field editors). Keyed by the caller on
// the selected unit's own id, so switching units remounts this fresh
// with the new unit's value instead of needing a manual useEffect sync.
function TextField({
  label,
  value,
  placeholder,
  type = 'text',
  onSave,
}: {
  label: string
  value: string | null
  placeholder?: string
  type?: string
  onSave: (value: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState(value ?? '')
  return (
    <label className="flex flex-col gap-1 text-sm text-muted-400">
      {label}
      <input
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== (value ?? '')) onSave(draft)
        }}
        className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
      />
    </label>
  )
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const color = STATUS_COLORS[status as Status] ?? 'bg-muted-500'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-300">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      {status}
    </span>
  )
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return formatDateTime(iso)
}

// TV wake/sleep schedule round (migration 0114) - HDMI-CEC, per-box
// (not per-tenant, same posture as the rest of this table - see
// migration's own comment). requirePlatformAdmin-only, same as every
// other control on this page; tenants never see this at all.
//
// Keyed by unit.id in UnitDetail below (same remount-on-switch pattern
// TextField's own comment documents) so switching units always starts
// from that unit's own saved schedule, not a stale draft.
function TvScheduleCard({
  unit,
  onSave,
  onOverride,
}: {
  unit: PiUnit
  onSave: (patch: { tvScheduleEnabled: boolean; tvSchedule: TvSchedule }) => Promise<void>
  onOverride: (action: 'wake' | 'sleep' | 'clear') => Promise<void>
}): JSX.Element {
  const [enabled, setEnabled] = useState(unit.tvScheduleEnabled)
  const [schedule, setSchedule] = useState<TvSchedule>(unit.tvSchedule ?? defaultTvSchedule())
  const [saving, setSaving] = useState(false)
  const [overrideBusy, setOverrideBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function updateDay(key: keyof TvSchedule, patch: Partial<TvDaySchedule>) {
    setSchedule((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await onSave({ tvScheduleEnabled: enabled, tvSchedule: schedule })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  async function handleOverride(action: 'wake' | 'sleep' | 'clear') {
    setOverrideBusy(true)
    setError(null)
    try {
      await onOverride(action)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set override')
    } finally {
      setOverrideBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">TV schedule (HDMI-CEC)</div>
        <label className="flex items-center gap-2 text-sm text-muted-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked)
              setSaved(false)
            }}
          />
          Enabled
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        {WEEKDAYS.map(({ key, label }) => {
          const day = schedule[key]
          return (
            <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <span className="w-24 shrink-0 text-sm text-muted-300">{label}</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-400">
                <input type="checkbox" checked={day.off} onChange={(e) => updateDay(key, { off: e.target.checked })} />
                Off all day
              </label>
              {!day.off && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-muted-400">
                    Wake
                    <input
                      type="time"
                      value={day.wake}
                      onChange={(e) => updateDay(key, { wake: e.target.value })}
                      className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-400">
                    Sleep
                    <input
                      type="time"
                      value={day.sleep}
                      onChange={(e) => updateDay(key, { sleep: e.target.value })}
                      className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-xs text-status-good">Saved</span>}
        {error && <span className="text-xs text-status-bad">{error}</span>}
      </div>

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-400">Test</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleOverride('wake')}
            disabled={overrideBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
          >
            Wake now
          </button>
          <button
            type="button"
            onClick={() => handleOverride('sleep')}
            disabled={overrideBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
          >
            Sleep now
          </button>
          {unit.tvScheduleOverrideActive && (
            <>
              <span className="text-xs text-accent-sky-400">
                Override: {unit.tvScheduleOverrideState} until{' '}
                {unit.tvScheduleOverrideUntil ? formatDateTime(unit.tvScheduleOverrideUntil) : '—'}
              </span>
              <button
                type="button"
                onClick={() => handleOverride('clear')}
                disabled={overrideBusy}
                className="rounded-lg border border-status-bad px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-status-bad hover:bg-status-bad/10 disabled:opacity-40"
              >
                Clear override
              </button>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-500">
          Picked up on the box's next check (within a minute), not instantly - the box only polls, there's no live push to it.
        </p>
      </div>

      <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-500">
        <div>
          Last seen: {unit.tvScheduleLastSeenAt ? `${formatDateTimeWithSeconds(unit.tvScheduleLastSeenAt)} (${formatTimeAgo(unit.tvScheduleLastSeenAt)})` : 'never'}
        </div>
        <div>
          Last command: {unit.tvScheduleLastCommand ?? '—'}
          {unit.tvScheduleLastCommandAt ? ` - ${formatDateTimeWithSeconds(unit.tvScheduleLastCommandAt)} (${formatTimeAgo(unit.tvScheduleLastCommandAt)})` : ''}
        </div>
        {unit.tvScheduleLastError && <div className="text-status-bad">Last error: {unit.tvScheduleLastError}</div>}
      </div>

      <p className="mt-4 rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-muted-500">
        Install checklist: enable HDMI-CEC in the TV's own menu first - Samsung: Anynet+, LG: SimpLink, Sony: Bravia Sync
        (other brands: look for "HDMI-CEC" or "Consumer Electronics Control"). Confirmed on a real Samsung TV: Anynet+
        alone isn't enough - "Auto Turn Off" must also be set to Yes, or standby commands are silently ignored (cec-ctl
        itself still reports success either way). Times are UK local (Europe/London) - BST/GMT handled automatically.
        Overnight schedules (sleep after midnight) aren't supported - sleep must be later than wake on the same day.
      </p>
    </section>
  )
}

// Full detail/edit view for one unit - four separate labeled cards
// (Unit, Deployment, Network, Notes log), deliberately not one long
// undifferentiated box (that's the exact density problem /platform/
// tenants' own detail pane has - see this page's own design notes).
function UnitDetail({
  unit,
  onPatch,
  onAddNote,
  onSaveTvSchedule,
  onOverrideTvSchedule,
}: {
  unit: PiUnit
  onPatch: (patch: Partial<PiUnit>) => void
  onAddNote: (noteText: string) => void
  onSaveTvSchedule: (patch: { tvScheduleEnabled: boolean; tvSchedule: TvSchedule }) => Promise<void>
  onOverrideTvSchedule: (action: 'wake' | 'sleep' | 'clear') => Promise<void>
}): JSX.Element {
  const [noteDraft, setNoteDraft] = useState('')

  function submitNote() {
    const trimmed = noteDraft.trim()
    if (!trimmed) return
    onAddNote(trimmed)
    setNoteDraft('')
  }

  return (
    <div key={unit.id} className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border bg-panel p-5">
        <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Unit</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Serial number" value={unit.serialNumber} onSave={(v) => onPatch({ serialNumber: v })} />
          <label className="flex flex-col gap-1 text-sm text-muted-400">
            Status
            <select
              value={unit.status}
              onChange={(e) => onPatch({ status: e.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Hostname" value={unit.hostname} placeholder="e.g. tiger-helicopters" onSave={(v) => onPatch({ hostname: v })} />
          <TextField label="Dashboard URL" value={unit.dashboardUrl} placeholder="https://…" onSave={(v) => onPatch({ dashboardUrl: v })} />
          <TextField
            label="Master image version"
            value={unit.masterImageVersion}
            placeholder="e.g. 2026-08-26 WORKING"
            onSave={(v) => onPatch({ masterImageVersion: v })}
          />
          <TextField
            label="Master image location (link)"
            value={unit.imageSourceLink}
            placeholder="Dropbox share link, or wherever the current master image lives"
            onSave={(v) => onPatch({ imageSourceLink: v })}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-5">
        <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Deployment</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Tenant name" value={unit.tenantName} placeholder="— unassigned —" onSave={(v) => onPatch({ tenantName: v })} />
          <TextField label="Date issued" value={unit.dateIssued} type="date" onSave={(v) => onPatch({ dateIssued: v })} />
          <TextField label="Physical address" value={unit.physicalAddress} onSave={(v) => onPatch({ physicalAddress: v })} />
          <div />
          <TextField label="Contact name" value={unit.contactName} onSave={(v) => onPatch({ contactName: v })} />
          <TextField label="Contact email" value={unit.contactEmail} type="email" onSave={(v) => onPatch({ contactEmail: v })} />
          <TextField label="Contact phone" value={unit.contactPhone} type="tel" onSave={(v) => onPatch({ contactPhone: v })} />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-panel p-5">
        <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Network</div>
        <TextField label="WiFi network name" value={unit.wifiNetworkName} placeholder="SSID only" onSave={(v) => onPatch({ wifiNetworkName: v })} />
        <p className="mt-2 text-xs text-muted-500">
          Network name only - the password is set directly on the device via SSH/nmcli and is never stored here.
        </p>
      </section>

      <TvScheduleCard key={unit.id} unit={unit} onSave={onSaveTvSchedule} onOverride={onOverrideTvSchedule} />

      <section className="rounded-2xl border border-border bg-panel p-5">
        <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Notes log</div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNote()
            }}
            placeholder="e.g. 26 Aug: swapped SD card, still under investigation"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={submitNote}
            disabled={!noteDraft.trim()}
            className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400 disabled:opacity-40"
          >
            Add note
          </button>
        </div>
        {unit.notes.length === 0 ? (
          <p className="text-sm text-muted-500">No notes yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {unit.notes.map((note) => (
              <div key={note.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="text-xs text-muted-500">{formatDateTime(note.createdAt)}</div>
                <div className="mt-1 text-sm text-muted-100">{note.noteText}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// Weather capture retention round's own convention reused here (see
// CaptureHistoryPage.tsx) - max-w-[1400px], not tenants' own
// max-w-[1900px], since this page's content is deliberately lighter and
// doesn't need that much width.
export default function PlatformPiFleetPage(): JSX.Element {
  useEffect(() => {
    document.title = 'Pi Fleet — Airfield Central'
  }, [])

  const [units, setUnits] = useState<PiUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null)
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newSerial, setNewSerial] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(PI_UNITS_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((json) => {
        if (json) {
          setUnits(json.units ?? [])
          if (json.units?.length > 0) setSelectedUnitId(json.units[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null

  function patchUnit(unitId: number, patch: Partial<PiUnit>) {
    // Optimistic - matches PlatformTenantsPage.tsx's own established
    // pattern (update local state immediately, PATCH in the background).
    setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, ...patch } : u)))
    fetch(`${PI_UNITS_URL}/${unitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((updated) => {
        if (updated) setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, ...updated } : u)))
      })
  }

  function addNote(unitId: number, noteText: string) {
    fetch(`${PI_UNITS_URL}/${unitId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteText }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (json?.notes) setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, notes: json.notes } : u)))
      })
  }

  // TV wake/sleep schedule round - deliberately NOT the generic
  // optimistic patchUnit() above: this has real server-side validation
  // (e.g. overnight-schedule rejection) the card needs to surface
  // inline, so it awaits the response and throws on failure instead of
  // firing-and-forgetting.
  async function saveTvSchedule(unitId: number, patch: { tvScheduleEnabled: boolean; tvSchedule: TvSchedule }) {
    const response = await fetch(`${PI_UNITS_URL}/${unitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) throw new Error(json?.error ?? 'Failed to save schedule')
    setUnits((prev) => prev.map((u) => (u.id === unitId ? { ...u, ...json } : u)))
  }

  async function overrideTvSchedule(unitId: number, action: 'wake' | 'sleep' | 'clear') {
    const response = await fetch(`${PI_UNITS_URL}/${unitId}/tv-schedule-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) throw new Error(json?.error ?? 'Failed to set override')
    setUnits((prev) =>
      prev.map((u) =>
        u.id === unitId
          ? { ...u, tvScheduleOverrideState: json.overrideState, tvScheduleOverrideUntil: json.overrideUntil, tvScheduleOverrideActive: json.overrideActive }
          : u
      )
    )
  }

  async function createUnit() {
    const serialNumber = newSerial.trim()
    if (!serialNumber) return
    setCreating(true)
    setCreateError(null)
    try {
      const response = await fetch(PI_UNITS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        setCreateError(json?.error ?? 'Failed to create unit.')
        return
      }
      setUnits((prev) => [{ ...json, notes: [] }, ...prev])
      setSelectedUnitId(json.id)
      setNewSerial('')
      setShowCreateInput(false)
    } finally {
      setCreating(false)
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
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-black uppercase tracking-wide text-primary">Platform · Pi Fleet</h1>
          {!showCreateInput ? (
            <button
              type="button"
              onClick={() => setShowCreateInput(true)}
              className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400"
            >
              + New unit
            </button>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex flex-col gap-1">
                <input
                  type="text"
                  autoFocus
                  value={newSerial}
                  onChange={(e) => setNewSerial(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createUnit()
                    if (e.key === 'Escape') {
                      setShowCreateInput(false)
                      setCreateError(null)
                    }
                  }}
                  placeholder="Serial number"
                  className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                />
                {createError && <span className="text-xs text-status-bad">{createError}</span>}
              </div>
              <button
                type="button"
                onClick={createUnit}
                disabled={creating || !newSerial.trim()}
                className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-white hover:bg-accent-sky-400 disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateInput(false)
                  setCreateError(null)
                  setNewSerial('')
                }}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <p className="mb-4 max-w-2xl text-sm text-muted-400">
          Inventory of physical Pi kiosk units - which unit is where, its config, and a dated history log. Reference only:
          this page doesn't flash cards, manage images, or reach the devices themselves.
        </p>

        {/* Pure static reference text, collapsed by default so it never
            competes with the actual inventory below for attention - see
            PilotCollapsibleSection's own comment for why this shared
            accordion (not a new one) is reused here. Title/section
            styling overridden to match this page's own established
            sub-heading look (the "Unit"/"Deployment"/"Network" card
            headers below) rather than the Pilot View defaults this
            component ships with.
            Readability round: max-w-2xl/text-sm read as cramped for
            something meant to be read carefully rather than skimmed -
            widened to max-w-5xl (noticeably more of the page's own
            max-w-[1400px] container, not full-bleed) and every text size
            inside bumped one step (text-sm -> text-base for the steps,
            text-xs -> text-sm for the command blocks, kept smaller than
            the steps themselves since they're already visually set apart
            by the dark background/monospace font). */}
        <div className="mb-6 max-w-5xl">
          <PilotCollapsibleSection
            title="How to prep a new Pi unit"
            sectionClassName="rounded-2xl border border-border bg-panel p-4"
            titleClassName="text-sm font-bold uppercase tracking-widest text-accent-sky-400"
            chevronClassName="text-accent-sky-400"
          >
            <ol className="mt-1 list-decimal space-y-3 pl-5 text-base text-muted-300">
              <li>
                Flash a fresh SD card using Raspberry Pi Imager, from the current master image (distributed via a Dropbox
                share link for now - check a recent unit's own "Master image location" field on this page for the current
                link; a move to Cloudflare R2 is planned but not built yet).
              </li>
              <li>
                Before writing, open Imager's advanced/customisation settings (the gear icon) and preset the new tenant's
                WiFi network name/password and a hostname for this unit - avoids needing a keyboard/mouse on first boot.
              </li>
              <li>
                Boot the card in the new Pi, then SSH in once it's on the network:
                <br />
                <code className="mt-1 inline-block rounded bg-slate-900/80 px-2 py-1 font-mono text-sm text-white">
                  ssh admin@&lt;hostname&gt;.local
                </code>
              </li>
              <li>
                Run:
                <br />
                <code className="mt-1 inline-block rounded bg-slate-900/80 px-2 py-1 font-mono text-sm text-white">
                  ./personalize-tenant.sh --url https://&lt;tenant-subdomain&gt;.airfieldcentral.com --hostname
                  &lt;tenant-hostname&gt;
                </code>
                <br />
                This writes <code className="font-mono text-sm text-white">tenant-config.txt</code>, sets the Pi's
                hostname, and reboots automatically into the new tenant's dashboard.
              </li>
              <li>Plug in an HDMI cable and visually confirm the dashboard loads correctly before shipping/installing the unit.</li>
              <li>
                Add a new entry to this page for the unit (serial number, hostname, dashboard URL, master image version,
                tenant details) so it's tracked going forward.
              </li>
            </ol>
          </PilotCollapsibleSection>
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-muted-500">No Pi units recorded yet - click "+ New unit" to add one.</p>
        ) : (
          <div className="flex min-h-[500px] flex-col gap-4 lg:flex-row">
            <div className="flex w-full flex-col gap-1.5 lg:w-72 lg:flex-shrink-0">
              {units.map((unit) => {
                const isSelected = unit.id === selectedUnitId
                const color = STATUS_COLORS[unit.status as Status] ?? 'bg-muted-500'
                return (
                  <div
                    key={unit.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedUnitId(unit.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedUnitId(unit.id)
                      }
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition ${
                      isSelected ? 'border-accent-sky-500 bg-accent-sky-500/10' : 'border-border bg-card hover:border-slate-600'
                    }`}
                  >
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${color}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${isSelected ? 'font-semibold text-white' : 'text-muted-300'}`}>
                        {unit.tenantName || '— unassigned —'}
                      </div>
                      <div className="truncate text-xs text-muted-500">
                        {unit.serialNumber}
                        {unit.hostname ? ` · ${unit.hostname}` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex-1">
              {selectedUnit && (
                <>
                  <div className="mb-4 flex items-center gap-3">
                    <h2 className="text-lg font-bold text-white">{selectedUnit.tenantName || '— unassigned —'}</h2>
                    <StatusBadge status={selectedUnit.status} />
                  </div>
                  <UnitDetail
                    unit={selectedUnit}
                    onPatch={(patch) => patchUnit(selectedUnit.id, patch)}
                    onAddNote={(noteText) => addNote(selectedUnit.id, noteText)}
                    onSaveTvSchedule={(patch) => saveTvSchedule(selectedUnit.id, patch)}
                    onOverrideTvSchedule={(action) => overrideTvSchedule(selectedUnit.id, action)}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
