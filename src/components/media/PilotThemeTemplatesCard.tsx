import { useEffect, useState } from 'react'
import type { PilotThemeOverride } from '../../utils/pilotThemeStyle'

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

export type PilotThemeColours = PilotThemeOverride

interface ThemeTemplate {
  id: string
  name: string
  theme: PilotThemeColours
  createdAt: string
}

// Built-in, hardcoded, non-persisted presets - same pattern as
// tickerStyleStore.ts's own BUILT_IN_TICKER_PRESETS (News/Christmas/
// Summer/Business Style), which this directly mirrors: a curated array
// a tenant can apply instantly, nothing to build/save first. Four
// distinct identities, same count as that precedent. Each is a complete
// bundle (every field set, not partial) so applying one always fully
// replaces whatever's currently staged, same "apply = replace the whole
// draft" behaviour a saved custom template already has. High Contrast
// Light is the one genuinely practical (not just aesthetic) option here
// - a light, high-contrast scheme reads better than a dark one in
// direct sunlight on a real phone screen, a real outdoor-cockpit
// consideration, not just a look.
const BUILT_IN_THEME_PRESETS: { id: string; name: string; theme: PilotThemeColours }[] = [
  {
    id: 'preset-high-contrast-light',
    name: 'High Contrast Light',
    theme: {
      backgroundColor: '#f5f5f0',
      panelBg: '#e8e8e0',
      cardBg: '#f5f5f0',
      compassDiscBg: '#e8e8e0',
      compassRing: '#334155',
      compassCardinal: '#334155',
      compassMarkers: '#475569',
      textColor: '#0f172a',
    },
  },
  {
    id: 'preset-ocean-blue',
    name: 'Ocean Blue',
    theme: {
      backgroundColor: '#0c2d48',
      panelBg: '#08202f',
      cardBg: '#0c2d48',
      compassDiscBg: '#08202f',
      compassRing: '#38bdf8',
      compassCardinal: '#38bdf8',
      compassMarkers: '#7dd3fc',
      textColor: '#ffffff',
    },
  },
  {
    id: 'preset-forest-green',
    name: 'Forest Green',
    theme: {
      backgroundColor: '#14251a',
      panelBg: '#0d1912',
      cardBg: '#14251a',
      compassDiscBg: '#0d1912',
      compassRing: '#4ade80',
      compassCardinal: '#4ade80',
      compassMarkers: '#86efac',
      textColor: '#ffffff',
    },
  },
  {
    id: 'preset-sunset-amber',
    name: 'Sunset Amber',
    theme: {
      backgroundColor: '#2b1a0f',
      panelBg: '#1f120a',
      cardBg: '#2b1a0f',
      compassDiscBg: '#1f120a',
      compassRing: '#fb923c',
      compassCardinal: '#fb923c',
      compassMarkers: '#fdba74',
      textColor: '#ffffff',
    },
  },
]

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
      <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Colour Schemes</div>
      <p className="mt-1 text-xs text-muted-500">
        Pick a ready-made preset below, or save the background, compass, info-panel, and text colours you've set as
        your own named scheme to reuse later. Either way, selecting a scheme only updates the staged colours on this
        page - nothing reaches the live dashboard until you click "Save Pilot Panel".
      </p>

      <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-400">Presets</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {BUILT_IN_THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onApply(preset.theme)}
            className="flex items-center gap-2 rounded-lg border border-border bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-accent-sky-500"
          >
            <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: preset.theme.backgroundColor }} />
            {preset.name}
          </button>
        ))}
      </div>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-400">Your Saved Schemes</div>
      {templates.length === 0 && <p className="mb-4 text-xs text-muted-500">No saved schemes yet.</p>}

      {templates.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5">
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
