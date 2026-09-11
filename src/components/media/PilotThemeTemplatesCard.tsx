import { useEffect, useState } from 'react'

// Pilot Panel's own saveable colour-scheme templates - direct structural
// copy of PilotTickerStyleCards.tsx's own template list (same component
// in spirit, this file exists separately rather than extending that one
// because it saves a completely different draft object - the background/
// compass/info-panel/text theme, not the ticker style). Server-persisted
// per tenant via /api/tenant/pilot-background-templates (migration 0104),
// same "named saved LIST of alternates, not the one currently-applied
// value" distinction pilot_background_override_json itself draws against
// this table.
//
// Unlike PilotTickerStyleCards.tsx's own template list (which
// deliberately skipped rename - that page's spec only asked for save/
// list/apply/delete), this round's spec explicitly wants rename too -
// mirrors DesignPage.tsx's own inline rename interaction (click Rename,
// input replaces the name, Save/Enter confirms) rather than inventing a
// new one.
const TEMPLATES_URL = '/api/tenant/pilot-background-templates'
const MAX_NAME_LENGTH = 60

export interface PilotThemeColours {
  backgroundColor: string
  compassDiscBg?: string
  compassRing?: string
  compassCardinal?: string
  compassMarkers?: string
  panelBg?: string
  cardBg?: string
  textColor?: string
}

interface ThemeTemplate {
  id: string
  name: string
  theme: PilotThemeColours
  createdAt: string
}

interface PilotThemeTemplatesCardProps {
  // null when the independent-background toggle is off - there is
  // nothing to save as a template yet in that state (see the render
  // below, which gates the whole "Save as template" row on this).
  // Applying a saved template always turns the toggle on implicitly,
  // same as picking any other colour below already does.
  theme: PilotThemeColours | null
  onApply: (theme: PilotThemeColours) => void
}

export default function PilotThemeTemplatesCard({ theme, onApply }: PilotThemeTemplatesCardProps): JSX.Element {
  const [templates, setTemplates] = useState<ThemeTemplate[]>([])
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(TEMPLATES_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.templates)) setTemplates(data.templates)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    const name = nameInput.trim()
    if (!name || !theme) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(TEMPLATES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, theme }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? "Couldn't save template")
        return
      }
      const created: ThemeTemplate = await response.json()
      setTemplates((prev) => [...prev, created])
      setNameInput('')
    } catch {
      setError("Couldn't save template")
    } finally {
      setSaving(false)
    }
  }

  function handleStartRename(template: ThemeTemplate) {
    setRenamingId(template.id)
    setRenameInput(template.name)
  }

  async function handleConfirmRename() {
    if (!renamingId) return
    const trimmed = renameInput.trim()
    if (!trimmed) return
    const id = renamingId
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${TEMPLATES_URL}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        setError("Couldn't rename template")
        return
      }
      setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, name: trimmed } : t)))
      setRenamingId(null)
      setRenameInput('')
    } catch {
      setError("Couldn't rename template")
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    const previous = templates
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    try {
      const response = await fetch(`${TEMPLATES_URL}/${id}`, { method: 'DELETE' })
      if (!response.ok) setTemplates(previous)
    } catch {
      setTemplates(previous)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-panel p-6">
      <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Saved Colour Schemes</div>
      <p className="mt-1 text-xs text-muted-500">
        Save the background, compass, info-panel, and text colours below as a named scheme you can reuse later.
        Selecting a saved scheme only updates the staged colours on this page - nothing reaches the live dashboard
        until you click "Save Pilot Panel".
      </p>

      {templates.length > 0 && (
        <div className="mb-4 mt-4 flex flex-col gap-1.5">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-slate-900/80 py-1.5 pl-2 pr-3"
            >
              {renamingId === template.id ? (
                <input
                  value={renameInput}
                  onChange={(event) => setRenameInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleConfirmRename()}
                  maxLength={MAX_NAME_LENGTH}
                  className="min-w-0 flex-1 rounded border border-border bg-slate-950 px-2 py-1 text-sm text-primary"
                  disabled={busy}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onApply(template.theme)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold text-slate-200 transition hover:text-accent-sky-400"
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                    style={{ backgroundColor: template.theme.backgroundColor }}
                  />
                  <span className="truncate">{template.name}</span>
                </button>
              )}
              <div className="flex shrink-0 items-center gap-3 text-xs">
                {renamingId === template.id ? (
                  <button type="button" onClick={handleConfirmRename} disabled={busy} className="font-semibold text-accent-sky-400 disabled:opacity-50">
                    Save
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleStartRename(template)}
                    disabled={busy}
                    className="text-muted-400 hover:text-primary disabled:opacity-50"
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(template.id)}
                  className="text-muted-500 hover:text-status-bad"
                  title="Delete this saved scheme"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {theme ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <input
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="New scheme name"
            maxLength={MAX_NAME_LENGTH}
            className="rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!nameInput.trim() || saving}
            className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save current colours as scheme'}
          </button>
          {error && <span className="text-xs font-semibold text-status-bad">{error}</span>}
        </div>
      ) : (
        <p className="mt-4 border-t border-border pt-4 text-xs text-muted-500">
          Turn on "Use independent mobile background" below to start saving colour schemes.
        </p>
      )}
    </section>
  )
}
