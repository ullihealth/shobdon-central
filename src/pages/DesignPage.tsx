import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import Header from '../components/Header'
import LeftInfoPanel from '../components/LeftInfoPanel'
import CentreDisplayPanel from '../components/CentreDisplayPanel'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherStatusIndicator from '../components/WeatherStatusIndicator'
import { WeatherProvider } from '../context/WeatherContext'
import { DEFAULT_WEATHER_CONFIG } from '../services/weatherConfigStore'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'
import { TENANT_CONFIG_URL, BRANDING_LOGO_URL } from '../config/publicApi'
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
import { TEMPLATE_SLOTS } from '../components/displayTemplates/templateRegistry'

// Forces the preview to mock data regardless of whatever weather source is
// actually configured for the real dashboard right now.
const MOCK_CONFIG = { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'mock' as const }

// The preview renders the real dashboard layout at its actual reference
// size, then scales the whole thing down with a single CSS transform - not
// a shrunken box with the layout crammed into it. That's what keeps every
// element (compass included) proportionally correct instead of clipped.
const PREVIEW_REFERENCE_WIDTH = 1920
const PREVIEW_REFERENCE_HEIGHT = 1080
const PREVIEW_DISPLAY_WIDTH = 1000
const PREVIEW_SCALE = PREVIEW_DISPLAY_WIDTH / PREVIEW_REFERENCE_WIDTH
const PREVIEW_DISPLAY_HEIGHT = PREVIEW_REFERENCE_HEIGHT * PREVIEW_SCALE

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
      '--color-compass-disc-bg',
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
    ],
  },
  // No Status Text (good/warn/bad) swatches: nothing in the preview or the
  // live dashboard reads text-status-good/warn/bad - only /design's and
  // /runways' own Delete/Remove buttons do, outside the preview entirely.
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

type ApplyStatus = 'idle' | 'working' | 'success' | 'error'

export default function DesignPage(): JSX.Element {
  const [templates, setTemplates] = useState<DesignTemplate[]>(() => loadDesignTemplates())
  const [activeTokens, setActiveTokens] = useState<DesignTokens>(CURRENT_LIVE_THEME.tokens)
  const [selectedId, setSelectedId] = useState<string>(CURRENT_LIVE_THEME_ID)
  const [nameInput, setNameInput] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')
  // Real tenant name for this preview's own Header - was previously never
  // fetched at all here (this page only PUTs to TENANT_CONFIG_URL to apply
  // a theme, never GETs it), so the preview always showed Header's
  // hardcoded "SHOBDON AIRFIELD" literal regardless of which tenant's
  // owner was previewing their own design.
  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.airfieldName) setAirfieldName(data.airfieldName as string)
        if (data?.logoUrl) setLogoUrl(data.logoUrl as string)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Branding (name + logo) - self-service editing, no confirm gate
  // (unlike handleApplyToLiveDashboard's theme push below, which
  // deliberately confirms because it repaints a shared physical
  // display) - a name/logo change is lower-stakes and saves immediately.
  // Only auto-populates from the fetch BEFORE the user has typed anything -
  // re-syncing on every airfieldName change (the original approach) could
  // silently clobber a user's in-progress edit if they started typing
  // during the brief window before TENANT_CONFIG_URL's fetch resolved.
  const [brandingNameInput, setBrandingNameInput] = useState('')
  const brandingNameTouchedRef = useRef(false)
  useEffect(() => {
    if (airfieldName && !brandingNameTouchedRef.current) setBrandingNameInput(airfieldName)
  }, [airfieldName])
  const [nameSaveStatus, setNameSaveStatus] = useState<ApplyStatus>('idle')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  async function handleSaveName() {
    const trimmed = brandingNameInput.trim()
    if (!trimmed || trimmed === airfieldName) return
    setNameSaveStatus('working')
    try {
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ airfieldName: trimmed }),
      })
      if (!response.ok) {
        setNameSaveStatus('error')
        return
      }
      setAirfieldName(trimmed)
      setNameSaveStatus('success')
    } catch {
      setNameSaveStatus('error')
    }
  }

  async function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLogoUploading(true)
    setLogoError(null)
    try {
      const response = await fetch(BRANDING_LOGO_URL, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setLogoError(data?.error || 'Upload failed - please try again.')
        return
      }
      if (data?.logoUrl) setLogoUrl(data.logoUrl as string)
    } catch {
      setLogoError('Upload failed - please try again.')
    } finally {
      setLogoUploading(false)
    }
  }

  // Dashboard Layout - which template renders at this tenant's own "/"
  // (tenant_displays 'main' row, migration 0027 - already-existing
  // infrastructure, reused as-is via the same owner-gated /api/tenant/
  // displays endpoint DisplayUrlList.tsx already uses for named
  // displays). Fetches the current row (if any) so switching templates
  // never clobbers an existing name/panelConfig - a tenant with no 'main'
  // row yet (e.g. newcustomer) falls back to sensible defaults on first
  // save, matching how the endpoint's own upsert semantics already work.
  const [mainDisplay, setMainDisplay] = useState<{ name: string; templateId: string; panelConfig: unknown } | null>(null)
  const [templateSaving, setTemplateSaving] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/displays')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const main = (data.displays ?? []).find((display: { slug: string }) => display.slug === 'main')
        if (main) setMainDisplay({ name: main.name, templateId: main.templateId, panelConfig: main.panelConfig })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const activeTemplateId = mainDisplay?.templateId ?? 'classic'

  // Named distinctly from the pre-existing handleSelectTemplate below
  // (colour-theme templates, unrelated) - a same-named function
  // declaration collision here would silently shadow one or the other
  // at runtime with no TypeScript error, since both are plain top-level
  // function declarations in the same component scope.
  async function handleSelectLayoutTemplate(templateId: string) {
    if (templateId === activeTemplateId) return
    if (
      !window.confirm(
        'Switch your live dashboard to this template? This affects every device that loads it (PC2, clubhouse display, etc.) immediately.'
      )
    ) {
      return
    }
    setTemplateSaving(templateId)
    setTemplateError(null)
    try {
      const response = await fetch('/api/tenant/displays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'main',
          name: mainDisplay?.name ?? 'Main Dashboard',
          templateId,
          panelConfig: mainDisplay?.panelConfig ?? { weather: true, compass: true, media: true, ops: true },
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setTemplateError(data?.error || "Couldn't switch templates - please try again.")
        return
      }
      setMainDisplay({ name: data.name, templateId: data.templateId, panelConfig: data.panelConfig })
    } catch {
      setTemplateError("Couldn't switch templates - please try again.")
    } finally {
      setTemplateSaving(null)
    }
  }

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

  // Distinct from "Save as template" (a local, personal action) - this
  // pushes activeTokens to every device that loads the dashboard, via the
  // same KV + refresh-flag mechanism "Refresh PC2 Now" already uses. Gated
  // behind a confirm() since it affects the shared, physically-visible
  // display, not just this browser.
  async function handleApplyToLiveDashboard() {
    if (
      !window.confirm(
        'Apply this theme to the live dashboard? This affects every device that loads it (PC2, clubhouse display, etc.) within about 15 seconds.'
      )
    ) {
      return
    }

    setApplyStatus('working')
    try {
      // Was a POST to the Worker's global theme KV key - now a PUT to the
      // tenant-scoped, authenticated config endpoint (this page is gated
      // behind login, so the session cookie is already present on this
      // same-origin request). REFRESH_TRIGGER_URL is unrelated to where
      // the theme is stored - it just tells PC2 to reload so its next
      // page load re-fetches the now-updated public config - untouched.
      const response = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: activeTokens }),
      })
      if (!response.ok) {
        setApplyStatus('error')
        return
      }
      await fetch(REFRESH_TRIGGER_URL)
      setApplyStatus('success')
    } catch {
      setApplyStatus('error')
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Dashboard Design</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Experiment freely - the preview below only reacts to the colours you pick here, and nothing is saved
        until you choose to. When you're ready, use "Apply to Live Dashboard" further down to push a theme to
        every device that loads the real dashboard.
      </p>

      {/* LIVE PREVIEW - isolated: CSS variable overrides only ever apply to this wrapper.
          Rendered at the dashboard's real 1920x1080 reference size (matching
          DashboardPage.tsx's own max-w-[1920px]/7%-1fr/23-54-23 layout exactly), then
          scaled down as one unit via transform - not squeezed into a shorter box - so
          every element, including the compass, stays proportionally correct instead
          of being clipped. */}
      <div
        className="mb-8 overflow-hidden rounded-2xl border border-border"
        style={{ width: PREVIEW_DISPLAY_WIDTH, height: PREVIEW_DISPLAY_HEIGHT, ...previewStyle }}
      >
        <div
          style={{
            width: PREVIEW_REFERENCE_WIDTH,
            height: PREVIEW_REFERENCE_HEIGHT,
            transform: `scale(${PREVIEW_SCALE})`,
            transformOrigin: 'top left',
          }}
        >
          <WeatherProvider forcedConfig={MOCK_CONFIG}>
            <div className="h-full w-full bg-gradient-to-b from-page-from via-page-via to-page-to p-10 text-slate-100">
              <div className="grid h-full grid-rows-[7%_1fr] gap-4">
                <Header airfieldName={airfieldName} logoUrl={logoUrl} rightSlot={<WeatherStatusIndicator />} />
                <div className="grid h-full grid-cols-[23%_54%_23%] gap-4">
                  <LeftInfoPanel />
                  <CentreDisplayPanel />
                  <RightInfoPanel />
                </div>
              </div>
            </div>
          </WeatherProvider>
        </div>
      </div>

      {/* BRANDING - name + logo, saved immediately (no confirm gate, unlike
          the theme "Apply to Live Dashboard" action below which repaints a
          shared physical display). Self-service: any owner/admin can use
          this without developer involvement. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Branding</div>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex-1">
            <label className="mb-1 block text-xs uppercase tracking-wide text-muted-400">Business name</label>
            <div className="flex gap-2">
              <input
                value={brandingNameInput}
                onChange={(event) => {
                  brandingNameTouchedRef.current = true
                  setBrandingNameInput(event.target.value)
                }}
                className="w-full rounded border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
                placeholder="Your Airfield Name"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={nameSaveStatus === 'working' || !brandingNameInput.trim() || brandingNameInput.trim() === airfieldName}
                className="shrink-0 rounded bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
              >
                {nameSaveStatus === 'working' ? 'Saving…' : 'Save'}
              </button>
            </div>
            {nameSaveStatus === 'success' && <p className="mt-1 text-xs text-status-good">Saved.</p>}
            {nameSaveStatus === 'error' && <p className="mt-1 text-xs text-status-bad">Couldn't save - please try again.</p>}
          </div>

          <div className="flex-1">
            <label className="mb-1 block text-xs uppercase tracking-wide text-muted-400">Logo</label>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-24 items-center justify-center rounded border border-border bg-slate-900">
                {logoUrl ? (
                  <img src={logoUrl} alt="Current logo" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-500">No logo</span>
                )}
              </div>
              <label className="cursor-pointer rounded bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white">
                {logoUploading ? 'Uploading…' : logoUrl ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  disabled={logoUploading}
                  className="hidden"
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-muted-500">PNG, JPG, SVG, or WebP, up to 2MB.</p>
            {logoError && <p className="mt-1 text-xs text-status-bad">{logoError}</p>}
          </div>
        </div>
      </section>

      {/* COLOUR PICKERS - shown before Templates/Apply so the workflow reads
          top-to-bottom: pick colours first, then save/apply them below. */}
      <div className="mb-8 flex flex-col gap-6">
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

      {/* DASHBOARD LAYOUT - which of the 5 template slots renders at this
          tenant's own "/" (the real live kiosk route). Distinct from the
          "Templates" section above, which is about colour themes, not
          page layout - kept as its own section immediately after it to
          avoid the two being confused for the same feature. */}
      <section className="mb-8 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Dashboard Layout</div>
        <p className="mb-4 text-xs text-muted-500">
          Choose which layout renders on your live dashboard. Switching takes effect immediately on every device that
          loads it.
        </p>
        {templateError && <p className="mb-3 text-sm font-semibold text-status-bad">{templateError}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {TEMPLATE_SLOTS.map((slot) => {
            const isActive = slot.id === activeTemplateId
            const isComingSoon = slot.status === 'coming-soon'
            const isSaving = templateSaving === slot.id
            return (
              <button
                key={slot.id}
                type="button"
                disabled={isComingSoon || isSaving}
                onClick={() => handleSelectLayoutTemplate(slot.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  isComingSoon
                    ? 'cursor-not-allowed border-border bg-slate-900/40 opacity-50'
                    : isActive
                      ? 'border-accent-sky-500 bg-slate-900'
                      : 'border-border bg-slate-900/80 hover:border-accent-sky-500/60'
                }`}
              >
                <div className="mb-2 flex aspect-video items-center justify-center rounded-lg border border-border bg-slate-950/60 text-[10px] uppercase tracking-wide text-muted-500">
                  {isComingSoon ? 'Coming soon' : slot.category === 'cafe' ? 'Café' : 'Clubhouse'}
                </div>
                <div className="text-xs font-semibold text-primary">{slot.label}</div>
                {isActive && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-accent-sky-400">Active</div>}
                {isComingSoon && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-500">Coming soon</div>}
                {isSaving && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-accent-sky-400">Switching…</div>}
              </button>
            )
          })}
        </div>
      </section>

      {/* APPLY TO LIVE DASHBOARD - deliberately separate from the Templates
          section above: this affects the shared, physically-visible
          display on every device, not just this browser's local template
          list, so it gets its own confirm-gated action and its own
          status feedback rather than being folded into "Save as template". */}
      <section className="mb-8 rounded-2xl border border-accent-sky-500/40 bg-panel p-6">
        <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Apply to Live Dashboard</div>
        <p className="mb-4 text-sm text-muted-400">
          Pushes the colours currently shown above to every device that loads the real dashboard - PC2, the
          clubhouse display, home browsers - within about 15 seconds.
        </p>
        <button
          type="button"
          onClick={handleApplyToLiveDashboard}
          disabled={applyStatus === 'working'}
          className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applyStatus === 'working' ? 'Applying…' : 'Apply to Live Dashboard'}
        </button>
        {applyStatus === 'success' && (
          <p className="mt-3 text-sm font-semibold text-status-good">✅ Applied - devices will pick it up within ~15 seconds.</p>
        )}
        {applyStatus === 'error' && (
          <p className="mt-3 text-sm font-semibold text-status-bad">❌ Could not apply the theme - check connectivity and try again.</p>
        )}
      </section>
    </div>
  )
}
