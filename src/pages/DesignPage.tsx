import { useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import CentreDisplayPanel from '../components/CentreDisplayPanel'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherStatusIndicator from '../components/WeatherStatusIndicator'
import { WeatherProvider } from '../context/WeatherContext'
import { DEFAULT_WEATHER_CONFIG } from '../services/weatherConfigStore'
import {
  CURRENT_LIVE_THEME,
  CURRENT_LIVE_THEME_ID,
  BRIGHT_BLUE_THEME,
  BRIGHT_BLUE_THEME_ID,
  DESIGN_TOKEN_KEYS,
  isValidDesignTokens,
  loadDesignTemplates,
  saveDesignTemplates,
} from '../services/designTemplateStore'
import type { DesignTemplate, DesignTokens } from '../services/designTemplateStore'

// Forces the preview to mock data regardless of whatever weather source is
// actually configured for the real dashboard right now.
const MOCK_CONFIG = { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'mock' as const }

const TOKEN_GROUPS: { title: string; keys: (keyof DesignTokens)[] }[] = [
  {
    title: 'Backgrounds',
    keys: [
      '--color-page-from',
      '--color-page-via',
      '--color-page-to',
      '--color-header-from',
      '--color-header-via',
      '--color-header-to',
      '--color-panel-bg',
      '--color-card-bg',
      '--color-border',
    ],
  },
  {
    title: 'Text',
    keys: ['--color-text-primary', '--color-text-muted-300', '--color-text-muted-400', '--color-text-muted-500'],
  },
  {
    title: 'Accent & Status',
    keys: [
      '--color-accent-sky-400',
      '--color-accent-sky-500',
      '--color-status-good-arrow',
      '--color-status-warn-arrow',
      '--color-status-bad-arrow',
      '--color-status-good-text',
      '--color-status-warn-text',
      '--color-status-bad-text',
    ],
  },
  // No "Compass" group: CompassPanel.tsx renders with literal colours only
  // (deliberately, post-regression-fix) and doesn't read these tokens, so
  // sliders for them here would silently do nothing.
]

function labelFor(key: keyof DesignTokens): string {
  return key.replace('--color-', '').replace(/-/g, ' ')
}

function parseRgba(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (!match) return null
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  }
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, '0')
}

// Native <input type="color"> only understands opaque #rrggbb - this shows the
// RGB part of a token for editing, whether it's stored as a hex or an rgba().
function rgbaToHex(value: string): string {
  const parsed = parseRgba(value)
  if (parsed) return `#${toHexByte(parsed.r)}${toHexByte(parsed.g)}${toHexByte(parsed.b)}`
  return value.startsWith('#') ? value : '#000000'
}

// Recombines the picker's new hue with the token's ORIGINAL alpha, so picking
// a colour for a semi-transparent token doesn't silently make it opaque.
function hexToRgbaPreservingAlpha(hex: string, originalValue: string): string {
  const parsed = parseRgba(originalValue)
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if (!parsed || parsed.a >= 1) return hex
  return `rgba(${r}, ${g}, ${b}, ${parsed.a})`
}

export default function DesignPage(): JSX.Element {
  const [templates, setTemplates] = useState<DesignTemplate[]>(() => loadDesignTemplates())
  const [activeTokens, setActiveTokens] = useState<DesignTokens>(CURRENT_LIVE_THEME.tokens)
  const [selectedId, setSelectedId] = useState<string>(CURRENT_LIVE_THEME_ID)
  const [nameInput, setNameInput] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const allTemplates = [CURRENT_LIVE_THEME, BRIGHT_BLUE_THEME, ...templates]

  function handleTokenChange(key: keyof DesignTokens, value: string) {
    setActiveTokens((prev) => ({ ...prev, [key]: value }))
    setSelectedId('')
  }

  function handleSelectTemplate(template: DesignTemplate) {
    setActiveTokens(template.tokens)
    setSelectedId(template.id)
  }

  function persistTemplates(next: DesignTemplate[]) {
    setTemplates(next)
    saveDesignTemplates(next)
  }

  function handleSaveAsTemplate() {
    const name = nameInput.trim()
    if (!name) return
    const next: DesignTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      tokens: activeTokens,
      createdAt: new Date().toISOString(),
    }
    persistTemplates([...templates, next])
    setSelectedId(next.id)
    setNameInput('')
  }

  function handleDuplicate(template: DesignTemplate) {
    const next: DesignTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${template.name} (copy)`,
      tokens: template.tokens,
      createdAt: new Date().toISOString(),
    }
    persistTemplates([...templates, next])
  }

  function handleStartRename(template: DesignTemplate) {
    setRenamingId(template.id)
    setRenameInput(template.name)
  }

  function handleConfirmRename() {
    if (!renamingId) return
    const trimmed = renameInput.trim()
    if (!trimmed) return
    persistTemplates(templates.map((t) => (t.id === renamingId ? { ...t, name: trimmed } : t)))
    setRenamingId(null)
    setRenameInput('')
  }

  function handleDelete(id: string) {
    persistTemplates(templates.filter((t) => t.id !== id))
    if (selectedId === id) {
      setActiveTokens(CURRENT_LIVE_THEME.tokens)
      setSelectedId(CURRENT_LIVE_THEME_ID)
    }
  }

  function handleExport() {
    const activeTemplate = allTemplates.find((t) => t.id === selectedId)
    const exportName = activeTemplate?.name ?? 'Untitled Theme'
    const blob = new Blob([JSON.stringify({ name: exportName, tokens: activeTokens }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${exportName.toLowerCase().replace(/\s+/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!isValidDesignTokens(parsed?.tokens)) {
          setImportError('That file is missing or has unexpected colour keys - nothing was imported.')
          return
        }
        const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Imported Theme'
        const next: DesignTemplate = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          tokens: parsed.tokens,
          createdAt: new Date().toISOString(),
        }
        persistTemplates([...templates, next])
        setActiveTokens(next.tokens)
        setSelectedId(next.id)
        setImportError(null)
      } catch {
        setImportError('That file is not valid JSON - nothing was imported.')
      }
    }
    reader.readAsText(file)
  }

  const previewStyle = Object.fromEntries(DESIGN_TOKEN_KEYS.map((key) => [key, activeTokens[key]])) as CSSProperties

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Link to="/config" className="text-sm font-semibold text-muted-400 hover:text-accent-sky-400">
          ← Back to Config
        </Link>
        <h1 className="mb-2 mt-3 text-2xl font-black uppercase tracking-wide text-primary">Dashboard Design</h1>
        <p className="mb-6 max-w-2xl text-sm text-muted-400">
          A sandbox for experimenting with the dashboard's colours. This preview only reacts to the colours
          below - it never affects the live dashboard, and nothing is saved to it. Applying a template to the
          real dashboard is a deliberate future step, not part of this tool.
        </p>

        {/* LIVE PREVIEW - isolated: CSS variable overrides only ever apply to this wrapper */}
        <div className="mb-8 overflow-hidden rounded-2xl border border-border" style={{ height: 620, ...previewStyle }}>
          <WeatherProvider forcedConfig={MOCK_CONFIG}>
            <div className="h-full w-full bg-gradient-to-b from-page-from via-page-via to-page-to p-6 text-slate-100">
              <div className="grid h-full grid-rows-[15%_1fr] gap-3">
                <Header rightSlot={<WeatherStatusIndicator />} />
                <div className="grid h-full grid-cols-[23%_54%_23%] gap-3">
                  <LeftInfoPanel />
                  <CentreDisplayPanel />
                  <RightInfoPanel />
                </div>
              </div>
            </div>
          </WeatherProvider>
        </div>

        {/* TEMPLATES */}
        <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
          <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Templates</div>

          <ul className="mb-4 flex flex-col gap-2">
            {allTemplates.map((template) => (
              <li
                key={template.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2 ${
                  selectedId === template.id ? 'border-accent-sky-500' : 'border-border'
                }`}
              >
                {renamingId === template.id ? (
                  <input
                    value={renameInput}
                    onChange={(event) => setRenameInput(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && handleConfirmRename()}
                    className="rounded border border-border bg-slate-900 px-2 py-1 text-sm text-primary"
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelectTemplate(template)}
                    className="text-left text-sm font-semibold text-primary"
                  >
                    {template.name}
                  </button>
                )}

                <div className="flex shrink-0 gap-3 text-xs">
                  {renamingId === template.id ? (
                    <button type="button" onClick={handleConfirmRename} className="text-accent-sky-400">
                      Save
                    </button>
                  ) : (
                    <>
                      {template.id !== CURRENT_LIVE_THEME_ID && template.id !== BRIGHT_BLUE_THEME_ID && (
                        <button type="button" onClick={() => handleStartRename(template)} className="text-muted-400 hover:text-primary">
                          Rename
                        </button>
                      )}
                      <button type="button" onClick={() => handleDuplicate(template)} className="text-muted-400 hover:text-primary">
                        Duplicate
                      </button>
                      {template.id !== CURRENT_LIVE_THEME_ID && template.id !== BRIGHT_BLUE_THEME_ID && (
                        <button type="button" onClick={() => handleDelete(template.id)} className="text-status-bad">
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="New template name"
              className="rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
            />
            <button
              type="button"
              onClick={handleSaveAsTemplate}
              className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white"
            >
              Save as template
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white"
            >
              Export JSON
            </button>
            <label className="cursor-pointer rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white">
              Import JSON
              <input type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
            </label>
          </div>
          {importError && <p className="mt-3 text-sm font-semibold text-status-bad">⚠️ {importError}</p>}
        </section>

        {/* COLOUR PICKERS */}
        <div className="flex flex-col gap-6">
          {TOKEN_GROUPS.map((group) => (
            <section key={group.title} className="rounded-2xl border border-border bg-panel p-6">
              <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{group.title}</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {group.keys.map((key) => (
                  <label key={key} className="flex items-center gap-3">
                    <input
                      type="color"
                      value={rgbaToHex(activeTokens[key])}
                      onChange={(event) => handleTokenChange(key, hexToRgbaPreservingAlpha(event.target.value, activeTokens[key]))}
                      className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <span className="text-xs capitalize text-muted-400">{labelFor(key)}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
