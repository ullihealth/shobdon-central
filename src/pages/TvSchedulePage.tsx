import { useEffect, useState } from 'react'

const TV_SCHEDULE_URL = '/api/tenant/tv-schedule'

// Deliberately a small, self-contained copy of Pi Fleet's own day-row
// shape (src/pages/PlatformPiFleetPage.tsx), not a shared component -
// the go-ahead's own "do not duplicate" instruction named
// validateSchedule()/computeNextTransition() specifically (both
// imported from the same functions/api/_utils/tvSchedule.mjs by both
// the admin and tenant-facing routes - see those routes' own comments),
// not this page's UI, which is simpler anyway (no last-command/error,
// single-tenant's-own boxes only).
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

interface TvScheduleBox {
  id: number
  serialNumber: string
  enabled: boolean
  schedule: TvSchedule | null
  overrideState: 'wake' | 'sleep' | null
  overrideUntil: string | null
  overrideActive: boolean
  lastSeenAt: string | null
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/London', timeZoneName: 'short',
  })
}

// Plain-English override time - "today at 7:00am" / "tomorrow at
// 10:00pm" / "Tue 20 Oct at 7:00am" - 12-hour, no seconds, no year, no
// BST/GMT (still computed in Europe/London, just not shown - customers
// don't need to see a timezone abbreviation for "later today").
// today/tomorrow is a pure Europe/London CALENDAR-day comparison (via
// Intl.formatToParts, not "within 24h of now"), same technique
// functions/api/_utils/tvSchedule.mjs's own computeNextTransition uses
// for its day-stepping - avoids being off by a day right around the UK
// clock-change.
function londonDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  )
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) }
}

function formatOverrideTime(iso: string): string {
  const target = new Date(iso)
  const todayParts = londonDateParts(new Date())
  const targetParts = londonDateParts(target)
  const todayCalendarUtc = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)
  const targetCalendarUtc = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day)
  const dayDiff = Math.round((targetCalendarUtc - todayCalendarUtc) / 86400000)

  const timeStr = target
    .toLocaleString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' })
    .replace(/\s/g, '')

  if (dayDiff === 0) return `today at ${timeStr}`
  if (dayDiff === 1) return `tomorrow at ${timeStr}`
  const weekdayMonth = target.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })
  return `${weekdayMonth} at ${timeStr}`
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

async function saveBox(boxId: number, patch: { enabled: boolean; schedule: TvSchedule }) {
  const response = await fetch(`${TV_SCHEDULE_URL}/${boxId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) throw new Error(json?.error ?? 'Failed to save schedule')
  return json as Pick<TvScheduleBox, 'enabled' | 'schedule' | 'overrideState' | 'overrideUntil' | 'overrideActive'>
}

async function overrideBox(boxId: number, action: 'wake' | 'sleep' | 'clear') {
  const response = await fetch(`${TV_SCHEDULE_URL}/${boxId}/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) throw new Error(json?.error ?? 'Failed to set override')
  return json as Pick<TvScheduleBox, 'overrideState' | 'overrideUntil' | 'overrideActive'>
}

function BoxCard({ box, onChange }: { box: TvScheduleBox; onChange: (patch: Partial<TvScheduleBox>) => void }): JSX.Element {
  const [enabled, setEnabled] = useState(box.enabled)
  const [schedule, setSchedule] = useState<TvSchedule>(box.schedule ?? defaultTvSchedule())
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
      const updated = await saveBox(box.id, { enabled, schedule })
      onChange(updated)
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
      const updated = await overrideBox(box.id, action)
      onChange(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set override')
    } finally {
      setOverrideBusy(false)
    }
  }

  return (
    <section key={box.id} className="rounded-2xl border border-border bg-panel p-5">
      <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{box.serialNumber}</div>
      <label className="mb-3 flex items-center gap-2 text-base text-slate-100">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked)
            setSaved(false)
          }}
        />
        Turn the TV on and off automatically at these times
      </label>

      <div className="flex flex-col gap-1.5">
        {WEEKDAYS.map(({ key, label }) => {
          const day = schedule[key]
          return (
            <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <span className="w-24 shrink-0 text-sm text-muted-300">{label}</span>
              <label className="flex items-center gap-1.5 text-sm text-muted-300">
                <input type="checkbox" checked={day.off} onChange={(e) => updateDay(key, { off: e.target.checked })} />
                Off all day
              </label>
              {!day.off && (
                <>
                  <label className="flex items-center gap-1.5 text-sm text-muted-300">
                    Wake
                    <input
                      type="time"
                      value={day.wake}
                      onChange={(e) => updateDay(key, { wake: e.target.value })}
                      className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-white focus:border-sky-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-muted-300">
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
        {saved && <span className="text-sm text-status-good">Saved</span>}
        {error && <span className="text-sm text-status-bad">{error}</span>}
      </div>

      <div className="mt-4 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleOverride('wake')}
            disabled={overrideBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
          >
            Turn TV on now
          </button>
          <button
            type="button"
            onClick={() => handleOverride('sleep')}
            disabled={overrideBusy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-300 hover:border-slate-500 hover:text-white disabled:opacity-40"
          >
            Turn TV off now
          </button>
        </div>
        {/* Clear-override button deliberately removed from THIS page only
            (customer-facing UX fix) - confusing alongside the automatic-
            times tick box. The API route is untouched and Pi Fleet keeps
            its own button; an active override here still expires on its
            own at the time shown below regardless. */}
        {box.overrideActive && box.overrideUntil && (
          <p className="mt-3 text-base text-slate-100">
            {box.overrideState === 'wake' ? 'You turned the TV on.' : 'You turned the TV off.'}
            {box.enabled && ` It will go back to its normal times ${formatOverrideTime(box.overrideUntil)}.`}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-300">
          Use these for one-off changes. The TV goes back to its normal times by itself at the next scheduled on or off time.
        </p>
        <p className="mt-1 text-sm text-muted-300">Changes reach the TV within about a minute.</p>
      </div>

      <div className="mt-4 border-t border-border/60 pt-3 text-sm">
        <span className="text-muted-400">Last seen: </span>
        <span className="text-white">
          {box.lastSeenAt ? `${formatDateTime(box.lastSeenAt)} (${formatTimeAgo(box.lastSeenAt)})` : 'never'}
        </span>
      </div>
    </section>
  )
}

export default function TvSchedulePage(): JSX.Element {
  useEffect(() => {
    document.title = 'TV Schedule — Airfield Central'
  }, [])

  const [boxes, setBoxes] = useState<TvScheduleBox[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    fetch(TV_SCHEDULE_URL)
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((json) => {
        if (json) setBoxes(json.boxes ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  function patchBox(boxId: number, patch: Partial<TvScheduleBox>) {
    setBoxes((prev) => prev.map((b) => (b.id === boxId ? { ...b, ...patch } : b)))
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-7xl px-6 pb-10 pt-10">
        <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
        <p className="text-sm text-muted-300">Owner or admin access required.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pb-10 pt-10">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">TV Schedule</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-300">
        Your TV must support HDMI-CEC.
      </p>

      {loading ? (
        <p className="text-sm text-muted-300">Loading…</p>
      ) : boxes.length === 0 ? (
        <p className="text-sm text-muted-300">No TV schedule box is set up for your account yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {boxes.map((box) => (
            <BoxCard key={box.id} box={box} onChange={(patch) => patchBox(box.id, patch)} />
          ))}
        </div>
      )}
    </div>
  )
}
