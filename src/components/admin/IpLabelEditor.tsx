import { useState } from 'react'
import { ColorPicker } from './ColorPicker'

const IP_LABELS_URL = '/api/platform/ip-labels'

// Sentinel, not an empty string - an empty string is ambiguous with "no
// selection yet" on a plain <select>, and a real group name could
// theoretically collide with it in a way "+ New label…" never will.
const NEW_LABEL_OPTION = '__new__'

interface IpLabelEditorProps {
  ipAddress: string
  initialGroupName: string | null
  initialColor: string | null
  // Same allGroupNames the Visit Log sidebar already computes - passed
  // in rather than fetched here, so this stays a dumb form component
  // with a single source of truth for "what labels exist" (its parent).
  allGroupNames: string[]
  onSaved: (groupName: string, color: string | null) => void
  onCancel?: () => void
}

// The single "assign this IP a label" form, shared by both entry points -
// PlatformVisitsPage.tsx's per-row expand panel (an existing IP, already
// on screen) and its "This is my device" button (a detected IP that may
// have no visible row at all). One component, two mount points, not two
// separate UIs - a real <select> of existing labels (plus an explicit
// "+ New label…" escape hatch) rather than the free-text-with-datalist-
// suggestions this replaced, which let the same device accumulate
// near-duplicate labels over time (a typo'd re-type was indistinguishable
// from a deliberate new group).
export function IpLabelEditor({ ipAddress, initialGroupName, initialColor, allGroupNames, onSaved, onCancel }: IpLabelEditorProps): JSX.Element {
  const hasExistingOptions = allGroupNames.length > 0
  const startsOnExisting = !!initialGroupName && allGroupNames.includes(initialGroupName)
  const [selection, setSelection] = useState<string>(startsOnExisting ? initialGroupName! : NEW_LABEL_OPTION)
  const [newGroupName, setNewGroupName] = useState(startsOnExisting ? '' : (initialGroupName ?? ''))
  const [color, setColor] = useState<string | null>(initialColor)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNewMode = selection === NEW_LABEL_OPTION || !hasExistingOptions
  const groupName = (isNewMode ? newGroupName : selection).trim()

  async function handleSave() {
    if (!groupName) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(IP_LABELS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ipAddress, groupName, color }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(typeof data?.error === 'string' ? data.error : "Couldn't save - please try again.")
        setSaving(false)
        return
      }
      onSaved(groupName, color)
    } catch {
      setError("Couldn't save - please try again.")
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
      {hasExistingOptions && (
        <select
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
        >
          {allGroupNames.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
          <option value={NEW_LABEL_OPTION}>+ New label…</option>
        </select>
      )}
      {isNewMode && (
        <input
          type="text"
          autoFocus={hasExistingOptions}
          placeholder="e.g. Jeff's Mac, Shobdon Café TV…"
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
          className="w-56 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
        />
      )}
      <ColorPicker value={color} onChange={setColor} />
      <button
        type="button"
        disabled={saving || !groupName}
        onClick={handleSave}
        className="rounded-lg border border-accent-sky-500/50 bg-accent-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent-sky-400 hover:border-accent-sky-400 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold uppercase tracking-widest text-muted-400 hover:text-primary"
        >
          Cancel
        </button>
      )}
      {error && <span className="text-xs text-status-bad">{error}</span>}
    </div>
  )
}
