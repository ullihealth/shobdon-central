import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import Header from '../components/Header'
import DisplayUrlList from '../components/config/DisplayUrlList'
import LeftInfoPanel from '../components/LeftInfoPanel'
import CentreDisplayPanel from '../components/CentreDisplayPanel'
import RightInfoPanel from '../components/RightInfoPanel'
import WeatherStatusIndicator from '../components/WeatherStatusIndicator'
import MediaPanel from '../components/media/MediaPanel'
import VenueCornerBadge from '../components/VenueCornerBadge'
import CafeTicker, { type TickerSlot, type TickerStyle } from '../components/CafeTicker'
import { WeatherProvider, useWeather } from '../context/WeatherContext'
import { useVisibilityForecast } from '../services/visibilityForecastService'
import { DEFAULT_WEATHER_CONFIG } from '../services/weatherConfigStore'
import { currentMedia } from '../config/media'
import { REFRESH_TRIGGER_URL } from '../config/captureEndpoint'
import { TENANT_CONFIG_URL, BRANDING_LOGO_URL, OPS_PANEL_URL } from '../config/publicApi'
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
import { DEFAULT_TICKER_STYLE } from '../services/tickerStyleStore'

// Forces the preview to mock data regardless of whatever weather source is
// actually configured for the real dashboard right now - this page's own
// established convention (predates Part B), kept for BOTH preview screens:
// this whole page is about experimenting with colours/templates freely,
// not about verifying live ticker content (CafeMediaPage.tsx's own
// preview already covers that, with real live weather, unchanged).
const MOCK_CONFIG = { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'mock' as const }

// The preview renders the real dashboard/café layout at its actual reference
// size, then scales the whole thing down with a single CSS transform - not
// a shrunken box with the layout crammed into it. That's what keeps every
// element (compass included) proportionally correct instead of clipped.
const PREVIEW_REFERENCE_WIDTH = 1920
const PREVIEW_REFERENCE_HEIGHT = 1080
const PREVIEW_DISPLAY_WIDTH = 1000
const PREVIEW_SCALE = PREVIEW_DISPLAY_WIDTH / PREVIEW_REFERENCE_WIDTH
const PREVIEW_DISPLAY_HEIGHT = PREVIEW_REFERENCE_HEIGHT * PREVIEW_SCALE

// `id` added for Part D's scrollspy sub-nav - each group renders as its
// own <section id={...}>, so the rail can jump to/highlight it. Kept on
// this same array (not a parallel list) so the nav and the actual
// rendered cards can never drift out of sync with each other.
const TOKEN_GROUPS: { id: string; title: string; keys: (keyof DesignTokens)[] }[] = [
  {
    id: 'backgrounds',
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
    id: 'text',
    title: 'Text',
    keys: ['--color-text-primary', '--color-text-muted-300', '--color-text-muted-400', '--color-text-muted-500'],
  },
  {
    id: 'accent-status',
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

// Part D's 6 sub-nav sections, in the exact order they're rendered -
// Branding and Templates/Your Displays aren't in TOKEN_GROUPS (they're
// not colour-token cards), so this list is the single source of truth
// for both the rail AND confirms nothing was silently dropped/reordered.
const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: 'branding', label: 'Branding' },
  ...TOKEN_GROUPS.map((group) => ({ id: group.id, label: group.title })),
  { id: 'templates', label: 'Templates' },
  { id: 'your-displays', label: 'Your Displays' },
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
type ScreenId = 'dashboard' | 'cafe'

interface DisplayInfo {
  name: string
  templateId: string
  panelConfig: unknown
}

function AdLabel(): JSX.Element {
  return (
    <div className="absolute right-2 top-2 z-10 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
      Advertisement
    </div>
  )
}

interface CafePreviewSettings {
  layoutMode: 'split' | 'full'
  adLabelEnabled: boolean
  tickerEnabled: boolean
  tickerSlots: TickerSlot[]
  tickerStyle: TickerStyle
}

const DEFAULT_CAFE_PREVIEW_SETTINGS: CafePreviewSettings = {
  layoutMode: 'full',
  adLabelEnabled: false,
  tickerEnabled: false,
  tickerSlots: Array.from({ length: 10 }, (_, i) => ({ position: i + 1, type: null, enabled: true })),
  tickerStyle: DEFAULT_TICKER_STYLE,
}

interface SafetyNoticeLike {
  id?: string
  name?: string
  text: string
  size: 'sm' | 'md' | 'lg' | 'xl'
  enabled: boolean
}

// Same ticker* wire-format mapping CafeTemplate.tsx and CafeMediaPage.tsx
// each already keep their own private copy of (see CafeTemplate.tsx's
// own comment on why this mapping exists - CafeTicker's own TickerStyle
// prop is deliberately unprefixed - and why it's duplicated rather than
// shared, matching this project's established per-file-copy convention
// for small shapes, e.g. SafetyNotice).
function cafeTickerStyleFromApi(data: Record<string, unknown>): TickerStyle {
  return {
    backgroundColor: (data.tickerBackgroundColor as string) ?? DEFAULT_TICKER_STYLE.backgroundColor,
    backgroundOpacity: (data.tickerBackgroundOpacity as number) ?? DEFAULT_TICKER_STYLE.backgroundOpacity,
    heightPx: (data.tickerHeightPx as number) ?? DEFAULT_TICKER_STYLE.heightPx,
    fontFamily: (data.tickerFontFamily as TickerStyle['fontFamily']) ?? DEFAULT_TICKER_STYLE.fontFamily,
    fontSizePx: (data.tickerFontSizePx as number) ?? DEFAULT_TICKER_STYLE.fontSizePx,
    fontColor: (data.tickerFontColor as string) ?? DEFAULT_TICKER_STYLE.fontColor,
    scrollSpeedPxPerSec: (data.tickerScrollSpeedPxPerSec as number) ?? DEFAULT_TICKER_STYLE.scrollSpeedPxPerSec,
    gapPx: (data.tickerGapPx as number) ?? DEFAULT_TICKER_STYLE.gapPx,
  }
}

interface ScreenPreviewProps {
  airfieldName: string | null
  logoUrl: string | null
}

// Mirrors CafeTemplate.tsx's own JSX (MediaPanel with `fill`, split/full
// layout, VenueCornerBadge, CafeTicker) - reused pieces, not a rebuilt
// implementation, matching this project's established "reuse existing
// rendering" convention. Self-contained fetch of this tenant's REAL
// café settings/notices (same endpoints CafeMediaPage.tsx itself uses),
// so switching the Part B toggle to Café shows the actual current café
// configuration - only the colour theme is the in-progress,
// not-yet-saved `activeTokens` value (applied via the shared outer
// preview wrapper's CSS variables, same as the Dashboard preview).
function CafePreview({ airfieldName, logoUrl }: ScreenPreviewProps): JSX.Element {
  const { weather, liveDataUnavailable } = useWeather()
  const { hours: visibilityHours } = useVisibilityForecast()
  const [settings, setSettings] = useState<CafePreviewSettings>(DEFAULT_CAFE_PREVIEW_SETTINGS)
  const [safetyNotices, setSafetyNotices] = useState<SafetyNoticeLike[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/cafe-settings')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setSettings({
          layoutMode: data.layoutMode === 'split' ? 'split' : 'full',
          adLabelEnabled: !!data.adLabelEnabled,
          tickerEnabled: !!data.tickerEnabled,
          tickerSlots: Array.isArray(data.tickerSlots) ? data.tickerSlots : DEFAULT_CAFE_PREVIEW_SETTINGS.tickerSlots,
          tickerStyle: cafeTickerStyleFromApi(data),
        })
      })
      .catch(() => {})
    fetch(OPS_PANEL_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        if (Array.isArray(data.safetyNotices)) setSafetyNotices(data.safetyNotices)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const { layoutMode, adLabelEnabled, tickerEnabled, tickerSlots, tickerStyle } = settings

  return (
    <div className="h-full w-full bg-gradient-to-b from-page-from via-page-via to-page-to p-10 text-slate-100">
      <div
        style={{ display: 'grid', gridTemplateRows: tickerEnabled ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '16px', height: '100%' }}
      >
        <div className="relative min-h-0">
          <div className="absolute left-0 top-0 z-10">
            <VenueCornerBadge airfieldName={airfieldName} logoUrl={logoUrl} />
          </div>

          {layoutMode === 'split' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="left" fill />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="right" fill />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className="relative h-full overflow-hidden">
              <MediaPanel item={currentMedia} fill />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {tickerEnabled && (
          <div className="flex-shrink-0">
            <CafeTicker
              slots={tickerSlots}
              weather={weather}
              liveDataUnavailable={liveDataUnavailable}
              visibilityHours={visibilityHours}
              safetyNotices={safetyNotices}
              style={tickerStyle}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// Part D scrollspy - plain IntersectionObserver, no library, same
// zero-heavy-dependency approach ResizeObserver usage already
// established elsewhere in this codebase (CloudVisibilityChart.tsx,
// CafeTicker.tsx). rootMargin carves out a thin band near the top of
// the viewport (below the sticky rail's own top offset) - a section is
// only considered "active" once its heading crosses that band, which is
// the standard scrollspy "highlight whatever just scrolled past the
// top" behaviour, not "highlight whatever's merely visible" (that would
// flicker between two adjacent sections whenever both are partially
// on-screen, which is most of the time on a page this long).
function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState(sectionIds[0] ?? '')
  const idsKey = sectionIds.join(',')

  useEffect(() => {
    const elements = sectionIds.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
        setActiveId(topmost.target.id)
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 }
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  return activeId
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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

  // Part B: which screen the preview panel shows, and which screen Part
  // C's grid-tile-click / merged Apply button target. Dashboard by
  // default - matches this page's pre-existing behaviour exactly until
  // a tenant deliberately switches it.
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard')

  // Branding (name + logo) - self-service editing, no confirm gate
  // (unlike handleApplyToLiveScreen's theme push below, which
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

  // Templates grid - which template renders on the Dashboard ('main')
  // and Café ('cafe-tv') named displays, tenant_displays (migration
  // 0027) - already-existing infrastructure, reused as-is via the same
  // owner-gated /api/tenant/displays endpoint DisplayUrlList.tsx already
  // uses. Fetches both current rows (if any) so switching templates
  // never clobbers an existing name/panelConfig - a tenant with no row
  // yet (e.g. newcustomer, or a tenant that's never used the café
  // screen) falls back to sensible defaults on first save, matching how
  // the endpoint's own upsert semantics already work.
  const [mainDisplay, setMainDisplay] = useState<DisplayInfo | null>(null)
  const [cafeDisplay, setCafeDisplay] = useState<DisplayInfo | null>(null)
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
        const cafe = (data.displays ?? []).find((display: { slug: string }) => display.slug === 'cafe-tv')
        if (cafe) setCafeDisplay({ name: cafe.name, templateId: cafe.templateId, panelConfig: cafe.panelConfig })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const activeTemplateId = mainDisplay?.templateId ?? 'classic'
  const cafeActiveTemplateId = cafeDisplay?.templateId ?? null
  // Whichever of the two the Part B toggle currently points at - the
  // single source of truth both the grid's tile-click and the merged
  // Apply button below key off, so neither can drift out of sync with
  // what the preview panel is actually showing.
  const activeIdForToggledScreen = activeScreen === 'dashboard' ? activeTemplateId : cafeActiveTemplateId

  // Toggle-aware (Part C) - was hardcoded to 'main' last round. Confirm
  // text and the no-op guard ("skip confirm/apply if the target screen
  // already shows that template") both already existed from last round;
  // this keeps both, just reading whichever screen is currently
  // toggled instead of assuming Dashboard.
  async function handleSelectLayoutTemplate(templateId: string) {
    const isDashboard = activeScreen === 'dashboard'
    if (templateId === activeIdForToggledScreen) return
    if (
      !window.confirm(
        isDashboard
          ? 'Switch your live dashboard to this template? This affects every device that loads it (PC2, clubhouse display, etc.) immediately.'
          : 'Switch your live café screen to this template? This affects every device that loads it immediately.'
      )
    ) {
      return
    }
    setTemplateSaving(templateId)
    setTemplateError(null)
    try {
      const targetDisplay = isDashboard ? mainDisplay : cafeDisplay
      const response = await fetch('/api/tenant/displays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: isDashboard ? 'main' : 'cafe-tv',
          name: targetDisplay?.name ?? (isDashboard ? 'Main Dashboard' : 'Clubhouse Cafe TV'),
          templateId,
          panelConfig: targetDisplay?.panelConfig ?? (isDashboard ? { weather: true, compass: true, media: true, ops: true } : null),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setTemplateError(data?.error || "Couldn't switch templates - please try again.")
        return
      }
      const nextDisplay = { name: data.name, templateId: data.templateId, panelConfig: data.panelConfig }
      if (isDashboard) setMainDisplay(nextDisplay)
      else setCafeDisplay(nextDisplay)
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

  // Part C merge: was two buttons ("Apply to Live Dashboard" for the
  // colour theme, "Apply to Live Cafe Screen" for the template) - now
  // one, toggle-aware. The colour theme is tenant-wide (there's only
  // ONE live theme, shared by every display, confirmed last round) so
  // it always pushes regardless of the toggle - "which screen" only
  // meaningfully changes the TEMPLATE half of this action. When toggled
  // to Dashboard, the template half is inherently a no-op: the grid's
  // own tile-click is the only way Dashboard's template ever changes,
  // and it already applies immediately, so there's nothing "selected
  // but not yet pushed" to send - this button then behaves exactly like
  // the old "Apply to Live Dashboard" (theme only). When toggled to
  // Café, it also pushes the Dashboard's current template to 'cafe-tv'
  // if that differs - exactly the old "Apply to Live Cafe Screen"
  // behaviour. Same window.confirm() pattern both old buttons already
  // used, not a new style.
  async function handleApplyToLiveScreen() {
    const isDashboard = activeScreen === 'dashboard'
    const needsTemplatePush = !isDashboard && activeTemplateId !== cafeActiveTemplateId

    if (
      !window.confirm(
        isDashboard
          ? 'Apply this theme to the live dashboard? This affects every device that loads it (PC2, clubhouse display, etc.) within about 15 seconds.'
          : `Apply this design to the live café screen? This updates the shared colour theme everywhere it's used${needsTemplatePush ? ', and switches the café screen to the template currently active on your dashboard' : ''} - devices pick up the colour change within about 15 seconds, the template change immediately.`
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
      const themeResponse = await fetch(TENANT_CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: activeTokens }),
      })
      if (!themeResponse.ok) {
        setApplyStatus('error')
        return
      }
      await fetch(REFRESH_TRIGGER_URL)

      if (needsTemplatePush) {
        const response = await fetch('/api/tenant/displays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: 'cafe-tv',
            name: cafeDisplay?.name ?? 'Clubhouse Cafe TV',
            templateId: activeTemplateId,
            panelConfig: cafeDisplay?.panelConfig ?? null,
          }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          setApplyStatus('error')
          return
        }
        setCafeDisplay({ name: data.name, templateId: data.templateId, panelConfig: data.panelConfig })
      }
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
  const activeSectionId = useScrollSpy(NAV_SECTIONS.map((s) => s.id))

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* HEADER ROW - Part B's Dashboard/Cafe toggle sits upper-right,
          above the preview panel, per your instruction. */}
      <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wide text-primary">Screens Design</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-slate-900/80 p-1">
          {(['dashboard', 'cafe'] as const).map((screen) => (
            <button
              key={screen}
              type="button"
              onClick={() => setActiveScreen(screen)}
              className={`rounded-md px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                activeScreen === screen ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-primary'
              }`}
            >
              {screen === 'dashboard' ? 'Dashboard' : 'Cafe'}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-muted-400">
        Experiment freely - the preview below only reacts to the colours you pick here, and nothing is saved
        until you choose to. When you're ready, use "Apply to Live Screen" in Templates further down to push a
        theme (and, on Café, the current template) to every device that loads the real {activeScreen === 'dashboard' ? 'dashboard' : 'café screen'}.
      </p>

      {/* LIVE PREVIEW - isolated: CSS variable overrides only ever apply to this wrapper.
          Rendered at the real 1920x1080 reference size (matching DashboardPage.tsx's own
          max-w-[1920px]/7%-1fr/23-54-23 layout, or CafeTemplate.tsx's own layout, exactly),
          then scaled down as one unit via transform - not squeezed into a shorter box - so
          every element stays proportionally correct instead of being clipped. Part B: which
          inner layout renders is the only thing the toggle changes - the outer scaled
          wrapper, WeatherProvider, and previewStyle CSS variables are shared by both. */}
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
            {activeScreen === 'dashboard' ? (
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
            ) : (
              <CafePreview airfieldName={airfieldName} logoUrl={logoUrl} />
            )}
          </WeatherProvider>
        </div>
      </div>

      {/* Part D: two-column layout - main content (all 6 cards, still
          fully expanded, still one scrollable page, nothing collapsed
          behind a click) plus a sticky scrollspy sub-nav rail. Chosen
          over an accordion deliberately, per your instruction: this is
          heading toward a commercial product for high-end airfield
          customers, and a persistent "on this page" rail (the same
          pattern GitHub/Stripe-style settings pages use) reads as more
          premium than content hidden behind clicks. Collapses to a
          single column below lg - the rail becomes unnecessary scroll
          weight on a narrow viewport where sticky positioning has much
          less room to be useful anyway. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_180px]">
        <div className="min-w-0">
          {/* BRANDING - name + logo, saved immediately (no confirm gate, unlike
              the theme "Apply to Live Screen" action below which repaints a
              shared physical display). Self-service: any owner/admin can use
              this without developer involvement. */}
          <section id="branding" className="mb-8 scroll-mt-6 rounded-2xl border border-border bg-panel p-6">
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

          {/* COLOUR PICKERS - Backgrounds / Text / Accent & Status, each
              its own id'd card so Part D's rail can jump to/highlight
              them individually. */}
          {TOKEN_GROUPS.map((group) => (
            <section key={group.id} id={group.id} className="mb-8 scroll-mt-6 rounded-2xl border border-border bg-panel p-6">
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

          {/* TEMPLATES - colour-theme save/export/import (Save as
              template etc.) AND the layout-template grid, both already
              lived in this card's predecessor sections; kept together
              here as ONE "Templates" card per Part D's 6-card list.
              "Apply to Live Screen" (Part C's merged button) now lives
              at the FOOT of this card, not as its own separate section -
              per your explicit instruction. */}
          <section id="templates" className="mb-8 scroll-mt-6 rounded-2xl border border-border bg-panel p-6">
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

            <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-border pb-6">
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
            {importError && <p className="mb-6 text-sm font-semibold text-status-bad">⚠️ {importError}</p>}

            {/* LAYOUT TEMPLATE GRID - which template renders on the
                TOGGLED screen (Part C). isActive's highlight now follows
                the toggle; both "Active on Dashboard"/"Active on Café"
                badges stay independent of it, showing ground truth for
                BOTH screens regardless of which one you're previewing. */}
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-400">
              Layout - {activeScreen === 'dashboard' ? 'Dashboard' : 'Café'} screen
            </div>
            <p className="mb-4 text-xs text-muted-500">
              Choose which layout renders on the screen selected above. Switching takes effect immediately on
              every device that loads it.
            </p>
            {templateError && <p className="mb-3 text-sm font-semibold text-status-bad">{templateError}</p>}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {TEMPLATE_SLOTS.map((slot) => {
                const isActive = slot.id === activeIdForToggledScreen
                const isActiveOnDashboard = slot.id === activeTemplateId
                const isActiveOnCafe = cafeActiveTemplateId !== null && slot.id === cafeActiveTemplateId
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
                    {isActiveOnDashboard && (
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-accent-sky-400">Active on Dashboard</div>
                    )}
                    {isActiveOnCafe && (
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-accent-sky-400">Active on Café</div>
                    )}
                    {isComingSoon && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-500">Coming soon</div>}
                    {isSaving && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-accent-sky-400">Switching…</div>}
                  </button>
                )
              })}
            </div>

            {/* APPLY TO LIVE SCREEN - Part C's merge of the old "Apply to
                Live Dashboard" (theme) and "Apply to Live Cafe Screen"
                (template) buttons into one, toggle-aware action. See
                handleApplyToLiveScreen's own comment for exactly what it
                does on each screen. Placed at the foot of THIS card, not
                its own section, per your explicit instruction. */}
            <div className="border-t border-accent-sky-500/40 pt-6">
              <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Apply to Live Screen</div>
              <p className="mb-4 text-sm text-muted-400">
                Pushes the colours currently shown above to every device that loads the real dashboard - PC2, the
                clubhouse display, home browsers - within about 15 seconds. When toggled to Café, also switches
                the café screen to the template currently active on your dashboard, if it differs.
              </p>
              <button
                type="button"
                onClick={handleApplyToLiveScreen}
                disabled={applyStatus === 'working'}
                className="rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applyStatus === 'working' ? 'Applying…' : 'Apply to Live Screen'}
              </button>
              {applyStatus === 'success' && (
                <p className="mt-3 text-sm font-semibold text-status-good">✅ Applied - devices will pick it up shortly.</p>
              )}
              {applyStatus === 'error' && (
                <p className="mt-3 text-sm font-semibold text-status-bad">❌ Could not apply - check connectivity and try again.</p>
              )}
            </div>
          </section>

          {/* YOUR DISPLAYS - last card per Part D's list. Pure
              relocation-safe: DisplayUrlList.tsx itself is unchanged,
              still its own self-contained GET /api/tenant/displays
              fetch. */}
          <section id="your-displays" className="mb-8 scroll-mt-6">
            <DisplayUrlList />
          </section>
        </div>

        {/* Part D sticky scrollspy rail - see useScrollSpy's own comment
            for how "currently in view" is determined. top-6 matches this
            page's own py-8 top padding roughly, so the rail doesn't sit
            flush against the browser chrome.
            Deliberately relying on the grid's own DEFAULT align-items:
            stretch here (no self-start/self-auto override) - `sticky`
            can only travel within its containing block's box, and this
            <nav> IS that containing block. The nav's own content (a
            handful of short buttons) is far shorter than the left
            column's six expanded cards, so if the nav's grid cell were
            allowed to shrink to fit its own content (self-start), the
            box the sticky div can stick within would be that same short
            height - it would run out of room to stick almost
            immediately and fall back to plain static flow for the rest
            of the page (confirmed live - this was the actual bug).
            Stretching the nav's grid cell to match the row's full
            height (driven by the tall left column) gives the sticky
            rail a tall-enough box to travel the whole way down,
            releasing only once the left column - and so the row -
            actually ends. */}
        <nav className="hidden lg:block">
          <div className="sticky top-6 flex flex-col gap-1 rounded-2xl border border-border bg-panel/60 p-3">
            {NAV_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => scrollToSection(section.id)}
                className={`rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide transition ${
                  activeSectionId === section.id
                    ? 'bg-accent-sky-500/15 text-accent-sky-400'
                    : 'text-muted-400 hover:bg-slate-900/60 hover:text-primary'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}
