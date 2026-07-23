import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import ColorField from '../components/ColorField'
import DisplayUrlList from '../components/config/DisplayUrlList'
import Clubhouse1Template from '../components/displayTemplates/Clubhouse1Template'
import Clubhouse2Template from '../components/displayTemplates/Clubhouse2Template'
import CafeTemplate from '../components/displayTemplates/CafeTemplate'
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
  BASE_COLOUR_OPTIONS,
  deriveBackgroundTokensFromAnchor,
  isValidDesignTokens,
  loadDesignTemplates,
  saveDesignTemplates,
} from '../services/designTemplateStore'
import type { DesignTemplate, DesignTokens } from '../services/designTemplateStore'
import { TEMPLATE_SLOTS } from '../components/displayTemplates/templateRegistry'
import { DEFAULT_TICKER_STYLE } from '../services/tickerStyleStore'

// Forces the preview to mock data regardless of whatever weather source is
// actually configured for the real dashboard right now - this page's own
// established convention, kept for BOTH preview screens: this whole page
// is about experimenting with colours/templates freely, not about
// verifying live ticker content (CafeMediaPage.tsx's own preview already
// covers that, with real live weather, unchanged).
const MOCK_CONFIG = { ...DEFAULT_WEATHER_CONFIG, activeProvider: 'mock' as const }

// The preview renders the real dashboard/café layout at its actual reference
// size, then scales the whole thing down with a single CSS transform - not
// a shrunken box with the layout crammed into it. That's what keeps every
// element (compass included) proportionally correct instead of clipped.
//
// PREVIEW_DISPLAY_WIDTH is the ONLY size knob - height and the scale factor
// are both derived from it below, so shrinking this one number shrinks the
// whole box uniformly. That matters for the 20% height reduction: dropping
// only the height while leaving width alone would either letterbox the
// content (blank space) or force a non-uniform stretch (distorted, and
// still clips - the inner content is a fixed 1920x1080 canvas transformed
// by a single scale() with no reflow of its own, so it has no way to
// "shrink into" a shorter box of the same width without one of those two
// outcomes). Shrinking width by the same 20% instead keeps the exact
// 16:9 aspect ratio, so the derived scale factor drops proportionally and
// everything inside - Weather Summary cards, compass, OPS panel, Media
// Panel, the café ticker - shrinks together as one image, the same way
// zooming a browser page out does. Nothing can clip or overlap as a result
// of this, structurally: transform: scale() never triggers layout reflow.
// 1000 * 0.8 = 800 (and the derived height, 562.5 * 0.8 = 450, comes out
// to a round number automatically via the same formula).
const PREVIEW_REFERENCE_WIDTH = 1920
const PREVIEW_REFERENCE_HEIGHT = 1080
// Lowered from 920 (the previous round's value, sized for a
// min-[1800px] trigger) to fit the new, much lower min-[1200px] trigger
// this round moves to (see that breakpoint's own comment above for why
// 1800 was wrong for v2's actual layout) - at 1200px viewport, minus the
// admin shell's own sidebar/padding, minus the left rail's ~34% share,
// there simply isn't room for a 920px-wide box without it overflowing
// its own column. 580 was reached in two measured passes against a
// running instance, not derived from arithmetic alone: an initial guess
// of 640 measured as fitting cleanly ONLY because the wrapper below was
// letting flexbox silently shrink it under 640 at the tightest trigger
// widths (confirmed via getBoundingClientRect, not assumed) - once
// flex-shrink-0 was added there to stop that silent shrink (which was
// quietly cropping the scaled preview's right edge, not harmlessly
// resizing it - see that class's own comment), 640 genuinely overflowed
// the viewport by up to 36px at exactly 1200px. 580 was re-measured
// clean (zero overflow) at every one of 1100/1150/1190/1195/1199/1200/
// 1201/1210/1280/1440/1512/1728/1920px.
const PREVIEW_DISPLAY_WIDTH = 580
const PREVIEW_SCALE = PREVIEW_DISPLAY_WIDTH / PREVIEW_REFERENCE_WIDTH
const PREVIEW_DISPLAY_HEIGHT = PREVIEW_REFERENCE_HEIGHT * PREVIEW_SCALE

// `id` doubles as each group's tab id - kept on this same array (not a
// parallel list) so the tab list and the actual rendered swatches can
// never drift out of sync with each other. No 'backgrounds' entry here
// any more - the Backgrounds nav item's content is now the merged
// Templates/Custom section below (see BACKGROUND_TOKEN_KEYS' own
// comment for where its 10 keys live now), not this generic
// activeTokenGroup renderer. Only Text and Accent & Status still route
// through it.
const TOKEN_GROUPS: { id: string; title: string; keys: (keyof DesignTokens)[] }[] = [
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

// No longer derived from TOKEN_GROUPS (that array dropped its
// 'backgrounds' entry - see its own comment) - these are the same 10
// keys the Custom sub-view inside the merged Backgrounds section
// renders, now its own standalone source of truth since there's no
// longer a generic token-group entry to derive them from.
const BACKGROUND_TOKEN_KEYS: (keyof DesignTokens)[] = [
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
]

type TabId = 'branding' | 'backgrounds' | 'text' | 'accent-status' | 'your-displays'

// The five left-rail nav items, in the exact order they render - single
// source of truth so the nav list and the conditional content blocks
// below can never silently drift out of sync or drop an entry.
// 'templates' and 'custom' used to be separate entries here (7 total) -
// both are now reachable only via the Templates/Custom toggle inside
// this 'backgrounds' entry's own content, per the instruction that
// Templates and Backgrounds "fundamentally edit the same thing... just
// via different UIs." The 'backgrounds' tab's rendered content is what
// used to live under 'templates' (the colour-chip browser); the old
// standalone raw-swatch Backgrounds content is now the Custom sub-view
// within it instead of its own top-level destination.
const TABS: { id: TabId; label: string }[] = [
  { id: 'branding', label: 'Branding' },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'text', label: 'Text' },
  { id: 'accent-status', label: 'Accent & Status' },
  { id: 'your-displays', label: 'Displays' },
]

// The two-column (left rail / preview) layout's own breakpoint.
// Previously min-[1800px], inherited unchanged from v1's completely
// different layout (preview + a second panel + a wide tabs pane sharing
// one row) - v1's own reasoning for that number ("sidebar + preview +
// tabs pane eats ~1150px, so a stock 1024/1280/1536 breakpoint would
// crush the right pane") no longer applies to v2's actual two-item row
// (left rail + preview only), and left at 1800 it meant almost no real
// desktop/laptop window ever saw the two-column layout this whole round
// was built to deliver - confirmed directly: at a normal ~1512-1728px
// browser width, the page was still falling back to the single-column
// stacked layout. Lowered to min-[1200px] (used directly as a literal
// class name throughout the JSX below, NOT built via string
// interpolation - Tailwind's JIT scanner greps source text statically
// and never evaluates JS template literals, so an interpolated
// `${CONST}:utility` silently vanishes from the compiled CSS with no
// build error; confirmed the hard way, see commit history) together
// with PREVIEW_DISPLAY_WIDTH's own reduction below (920 -> 640) so the
// preview box actually fits the right column's real available width at
// this new, lower trigger point instead of overflowing it - verified
// directly against a running instance at 1200/1280/1440/1512/1728/1920,
// not computed on paper (this page's own `clamp()`-based root font-size
// makes hand-computed "does this fit" math unreliable, the same lesson
// v1's own comment already learned the hard way for a different value).

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

// Migration 0039 - see Header.tsx/VenueCornerBadge.tsx's own copies of
// this same shape for the full reasoning (independent logo/name
// display settings for the two places branding renders).
interface BrandDisplaySettings {
  showLogo: boolean
  showName: boolean
  nameFontSize: 'sm' | 'md' | 'lg' | 'xl'
}

const DEFAULT_BRAND_DISPLAY_SETTINGS: BrandDisplaySettings = { showLogo: true, showName: true, nameFontSize: 'md' }

interface ScreenPreviewProps {
  airfieldName: string | null
  logoUrl: string | null
  gradientMode: 'solid' | 'gradient'
  brandCafe: BrandDisplaySettings
}

// Mirrors CafeTemplate.tsx's own JSX (MediaPanel with `fill`, split/full
// layout, VenueCornerBadge, CafeTicker) - reused pieces, not a rebuilt
// implementation, matching this project's established "reuse existing
// rendering" convention. Self-contained fetch of this tenant's REAL
// café settings/notices (same endpoints CafeMediaPage.tsx itself uses),
// so switching the toggle to Café shows the actual current café
// configuration - only the colour theme is the in-progress,
// not-yet-saved `activeTokens` value (applied via the shared outer
// preview wrapper's CSS variables, same as the Dashboard preview).
function CafePreview({ airfieldName, logoUrl, gradientMode, brandCafe }: ScreenPreviewProps): JSX.Element {
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
    <div
      className={`h-full w-full p-10 text-slate-100 ${
        gradientMode === 'solid' ? 'bg-page-via' : 'bg-gradient-to-b from-page-from via-page-via to-page-to'
      }`}
    >
      <div
        style={{ display: 'grid', gridTemplateRows: tickerEnabled ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)', gap: '16px', height: '100%' }}
      >
        {/* min-w-0: see the ticker wrapper's own comment below - same
            grid-item min-width:auto blowout risk applies here too. */}
        <div className="relative min-h-0 min-w-0">
          <div className="absolute left-0 top-0 z-10">
            <VenueCornerBadge
              airfieldName={airfieldName}
              logoUrl={logoUrl}
              showLogo={brandCafe.showLogo}
              showName={brandCafe.showName}
              nameFontSize={brandCafe.nameFontSize}
            />
          </div>

          {layoutMode === 'split' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '16px', height: '100%' }}>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="left" fill slotSource="cafe" />
                {adLabelEnabled && <AdLabel />}
              </div>
              <div className="relative h-full overflow-hidden">
                <MediaPanel item={currentMedia} zone="right" fill slotSource="cafe" />
                {adLabelEnabled && <AdLabel />}
              </div>
            </div>
          ) : (
            <div className="relative h-full overflow-hidden">
              <MediaPanel item={currentMedia} fill slotSource="cafe" />
              {adLabelEnabled && <AdLabel />}
            </div>
          )}
        </div>

        {/* overflow-hidden + min-w-0: this wrapper, not CafeTicker's own
            inner box, is the actual grid item in the single-column grid
            above - grid items default to min-width:auto (content-based),
            so without this the ticker's deliberately-wider-than-viewport
            marquee track (duplicated content for a seamless loop) wins
            the grid track's width calculation and inflates every row in
            this grid, including the media panel's. Same fix as
            CafeTemplate.tsx and CafeMediaPage.tsx's own ticker wrappers -
            this is the third hand-maintained mirror of that same JSX
            (Screens Design's own café preview), which is why this exact
            bug kept resurfacing in a new place each time only one copy
            got fixed. */}
        {tickerEnabled && (
          <div className="min-w-0 overflow-hidden">
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

export default function DesignPage(): JSX.Element {
  const [templates, setTemplates] = useState<DesignTemplate[]>(() => loadDesignTemplates())
  const [activeTokens, setActiveTokens] = useState<DesignTokens>(CURRENT_LIVE_THEME.tokens)
  // Solid/Gradient toggle - part of the saved template (DesignTemplate.
  // gradientMode), not session-only preview state, so it round-trips
  // through save/export/import. Defaults 'gradient' (today's only
  // behaviour) both here and for any template saved before this field
  // existed - see that field's own comment in designTemplateStore.ts.
  const [activeGradientMode, setActiveGradientMode] = useState<'solid' | 'gradient'>('gradient')
  const [selectedId, setSelectedId] = useState<string>(CURRENT_LIVE_THEME_ID)
  const [nameInput, setNameInput] = useState('')
  // Templates list's "base colour" filter chip row - null means no chip
  // selected, show every template (today's behaviour, unchanged). One of
  // BASE_COLOUR_OPTIONS' own `id` values when a chip is active. Clicking
  // the already-active chip again clears back to null (see the chip
  // row's onClick below) rather than requiring a separate "Clear" control.
  const [baseColourFilter, setBaseColourFilter] = useState<string | null>(null)
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
  // Migration 0039 - independent logo/name display settings for
  // Header.tsx ('main', the Dashboard preview below) vs
  // VenueCornerBadge.tsx ('cafe', CafePreview below). Defaults match
  // the same "show both, medium size" behaviour Header.tsx/
  // VenueCornerBadge.tsx themselves default to - a no-op appearance
  // until this fetch resolves or an admin actually changes something.
  const [brandMain, setBrandMain] = useState<BrandDisplaySettings>(DEFAULT_BRAND_DISPLAY_SETTINGS)
  const [brandCafe, setBrandCafe] = useState<BrandDisplaySettings>(DEFAULT_BRAND_DISPLAY_SETTINGS)
  const [brandSaveStatus, setBrandSaveStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  // Migration 0040 - up to 5 reusable brand colours, shared/global
  // across every ColorField instance on this page (Text, Accent &
  // Status, Backgrounds/Custom all read/write this SAME array, not
  // three separate copies) - see ColorField.tsx's own comment for the
  // full reasoning on why this lives here rather than per-picker state.
  const [savedSwatches, setSavedSwatches] = useState<string[]>([])
  const [swatchError, setSwatchError] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.airfieldName) setAirfieldName(data.airfieldName as string)
        if (data?.logoUrl) setLogoUrl(data.logoUrl as string)
        if (data?.brandDisplay?.main) setBrandMain(data.brandDisplay.main)
        if (data?.brandDisplay?.cafe) setBrandCafe(data.brandDisplay.cafe)
        if (Array.isArray(data?.savedSwatches)) setSavedSwatches(data.savedSwatches)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function handleSaveBrandDisplay(nextMain: BrandDisplaySettings, nextCafe: BrandDisplaySettings) {
    setBrandMain(nextMain)
    setBrandCafe(nextCafe)
    setBrandSaveStatus('working')
    fetch(TENANT_CONFIG_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandDisplay: { main: nextMain, cafe: nextCafe } }),
    })
      .then((response) => setBrandSaveStatus(response.ok ? 'success' : 'error'))
      .catch(() => setBrandSaveStatus('error'))
  }

  // Immediate PUT, no confirm, no applyStatus/Apply-to-live-screen gate -
  // saving/clearing a swatch never changes anything rendered anywhere
  // (it's just a reusable colour sitting in a palette), unlike an actual
  // token edit. Optimistic local update first (every ColorField instance
  // re-renders from the same savedSwatches state immediately), reverted
  // if the PUT fails.
  function persistSavedSwatches(next: string[]) {
    const previous = savedSwatches
    setSavedSwatches(next)
    setSwatchError(false)
    fetch(TENANT_CONFIG_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ savedSwatches: next }),
    })
      .then((response) => {
        if (!response.ok) {
          setSavedSwatches(previous)
          setSwatchError(true)
        }
      })
      .catch(() => {
        setSavedSwatches(previous)
        setSwatchError(true)
      })
  }

  function handleCaptureSwatch(hex: string) {
    if (savedSwatches.includes(hex) || savedSwatches.length >= 5) return
    persistSavedSwatches([...savedSwatches, hex])
  }

  function handleClearSwatch(hex: string) {
    persistSavedSwatches(savedSwatches.filter((s) => s !== hex))
  }

  // Which screen the preview panel shows, and which screen the grid-tile-
  // click / merged Apply button target. Dashboard by default. Lives at the
  // page level (not inside either pane) precisely because it must keep
  // working the same regardless of which settings tab is open, per this
  // round's instruction - it's rendered inside the left pane's JSX, but the
  // state itself is shared page state, not owned by any one tab.
  const [activeScreen, setActiveScreen] = useState<ScreenId>('dashboard')

  // Which of the 5 left-rail items is currently selected. Branding by
  // default, per an earlier round's instruction (still true after
  // consolidating Templates/Custom into Backgrounds).
  const [activeTab, setActiveTab] = useState<TabId>('branding')
  // Inside the merged 'backgrounds' tab specifically: which of the two
  // sub-views is showing - the colour-chip/template browser (what used
  // to be the standalone Templates tab's content), or the raw swatch
  // editor (what used to be the standalone Custom tab's content, itself
  // originally the standalone Backgrounds tab's content before that).
  // Resets to 'templates' only on mount, not on every tab switch away
  // and back - deliberately not reset elsewhere, so leaving Backgrounds
  // for Text and coming back keeps whichever sub-view was open.
  const [backgroundsView, setBackgroundsView] = useState<'templates' | 'custom'>('templates')

  // The former explanatory paragraph, now behind an info icon's popover
  // instead of sitting permanently on the page. No toast/popover library
  // exists anywhere in this codebase (window.confirm is the only
  // established dialog pattern) so this is a small self-contained
  // implementation: toggled by the icon itself, and dismissed either by
  // clicking the icon again, the popover's own close button, or clicking
  // anywhere outside it - the mousedown listener below only attaches while
  // open, so it costs nothing the rest of the time.
  const [infoOpen, setInfoOpen] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!infoOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(event.target as Node)) {
        setInfoOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [infoOpen])

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
  // Pending (not-yet-applied) template selection per screen - separate
  // from mainDisplay/cafeDisplay above, which stay the genuinely LIVE
  // record (last fetched, or last successfully applied). Selecting a
  // template card only ever updates these two; nothing reaches the
  // server until "Apply to live screen" is clicked, matching exactly
  // how colour edits already work via activeTokens. null until the
  // initial fetch resolves, then seeded to match whatever's live -
  // same "no behaviour change before the fetch resolves" stance
  // activeTokens' own CURRENT_LIVE_THEME seed already has.
  const [pendingMainTemplateId, setPendingMainTemplateId] = useState<string | null>(null)
  const [pendingCafeTemplateId, setPendingCafeTemplateId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/displays')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const main = (data.displays ?? []).find((display: { slug: string }) => display.slug === 'main')
        if (main) {
          setMainDisplay({ name: main.name, templateId: main.templateId, panelConfig: main.panelConfig })
          setPendingMainTemplateId(main.templateId)
        }
        const cafe = (data.displays ?? []).find((display: { slug: string }) => display.slug === 'cafe-tv')
        if (cafe) {
          setCafeDisplay({ name: cafe.name, templateId: cafe.templateId, panelConfig: cafe.panelConfig })
          setPendingCafeTemplateId(cafe.templateId)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Genuinely LIVE ids - drive the "Active on Dashboard"/"Active on
  // Café" badges only. Never used for the grid's selection highlight or
  // the preview pane anymore - see pendingMainId/pendingCafeId below.
  const activeTemplateId = mainDisplay?.templateId ?? 'classic'
  const cafeActiveTemplateId = cafeDisplay?.templateId ?? null

  // PENDING ids - what's currently selected in the UI, defaulting to
  // live once fetched. These drive the grid's highlight border and the
  // preview pane's template dispatch below - the whole point being
  // that they can differ from the live ids above until Apply is
  // clicked. Café's fallback ('cafe-1') matches the only built,
  // selectable café option today rather than leaving it null with
  // nothing sensible to highlight/preview for a tenant that's never
  // touched the café screen.
  const pendingMainId = pendingMainTemplateId ?? activeTemplateId
  const pendingCafeId = pendingCafeTemplateId ?? cafeActiveTemplateId ?? 'cafe-1'
  const pendingIdForToggledScreen = activeScreen === 'dashboard' ? pendingMainId : pendingCafeId

  // Selecting a card only updates the pending selection for whichever
  // screen is currently toggled - no confirm(), no network write.
  // Exactly mirrors handleSelectTemplate above (colour templates):
  // the preview reacts immediately, nothing is live until "Apply to
  // live screen" is clicked.
  function handleSelectLayoutTemplate(templateId: string) {
    if (activeScreen === 'dashboard') setPendingMainTemplateId(templateId)
    else setPendingCafeTemplateId(templateId)
  }

  const allTemplates = [CURRENT_LIVE_THEME, BRIGHT_BLUE_THEME, ...templates]
  // Filters the LIST (colour templates) only - TEMPLATE_SLOTS below (the
  // Clubhouse/Café LAYOUT grid) is a completely separate concept with no
  // colour tag of its own and is deliberately untouched. A template with
  // no baseColour yet (every existing/imported one, until the ~30-preset
  // import task tags them) simply doesn't match any chip - expected, not
  // a bug: there's nothing to filter until templates are actually tagged.
  const visibleTemplates = baseColourFilter
    ? allTemplates.filter((template) => template.baseColour === baseColourFilter)
    : allTemplates

  function handleTokenChange(key: keyof DesignTokens, value: string) {
    setActiveTokens((prev) => ({ ...prev, [key]: value }))
    setSelectedId('')
  }

  function handleSelectTemplate(template: DesignTemplate) {
    setActiveTokens(template.tokens)
    setActiveGradientMode(template.gradientMode ?? 'gradient')
    setSelectedId(template.id)
  }

  // Chip click now does three things, not just filtering: toggles the
  // filter itself (unchanged), then updates the live preview immediately
  // - either by auto-selecting the first matching template (same
  // instant-preview path a direct template-row click already uses), or,
  // when nothing is tagged with that colour yet (true for most of the 13
  // chips today), generating an on-the-fly preview from that chip's own
  // anchor colour. The synthetic case deliberately does NOT touch
  // selectedId (nothing was actually selected) or activeGradientMode
  // (respects whatever Solid/Gradient the user currently has toggled,
  // per instruction, rather than forcing a value) - only the derived
  // background tokens are merged onto whatever's already active, since
  // the anchor list only defines the 10 Backgrounds-tab tokens, not a
  // complete theme. Clicking the already-active chip again clears the
  // filter and leaves the preview exactly as it was - only a genuine
  // colour change (a different chip) updates the preview, matching
  // "clicking a chip updates the preview," not "clearing a filter
  // randomly changes what's on screen."
  function handleSelectBaseColourChip(colourId: string) {
    const next = baseColourFilter === colourId ? null : colourId
    setBaseColourFilter(next)
    if (!next) return

    const matches = allTemplates.filter((template) => template.baseColour === next)
    if (matches.length > 0) {
      handleSelectTemplate(matches[0])
      return
    }

    const derived = deriveBackgroundTokensFromAnchor(next)
    if (!derived) return
    setActiveTokens((prev) => ({ ...prev, ...derived }))
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
      gradientMode: activeGradientMode,
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
      gradientMode: template.gradientMode,
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
      setActiveGradientMode(CURRENT_LIVE_THEME.gradientMode ?? 'gradient')
      setSelectedId(CURRENT_LIVE_THEME_ID)
    }
  }

  // Single toggle-aware action pushing everything pending for whichever
  // screen is currently toggled. The colour theme is tenant-wide (one
  // shared club_theme record) so it always pushes regardless of the
  // toggle; the template push is scoped ONLY to the toggled screen's
  // own pending selection now - no more cross-screen sync. Previously,
  // applying while toggled to Café also silently copied Dashboard's
  // template onto café if they differed ("switches the café screen to
  // the template currently active on your dashboard") - removed
  // entirely, since template selection is genuinely independent per
  // screen now, same as every other setting on this page. Applying
  // Café's pending template no longer touches Dashboard's live
  // template, and vice versa.
  async function handleApplyToLiveScreen() {
    const isDashboard = activeScreen === 'dashboard'
    const targetDisplay = isDashboard ? mainDisplay : cafeDisplay
    const liveTemplateId = isDashboard ? activeTemplateId : cafeActiveTemplateId
    const pendingTemplateId = isDashboard ? pendingMainId : pendingCafeId
    const needsTemplatePush = pendingTemplateId !== liveTemplateId

    // Same conditional-text pattern the old café-sync case already
    // used, generalized to "does THIS screen's own pending template
    // differ from live" instead of "does café differ from dashboard".
    // The no-template-change branch is byte-for-byte the original
    // dashboard/café confirm text - zero wording change for the common
    // case where only colour is being applied.
    const screenLabel = isDashboard ? 'live dashboard' : 'live café screen'
    const confirmMessage = isDashboard
      ? `Apply this theme${needsTemplatePush ? ' and layout template' : ''} to the ${screenLabel}? This affects every device that loads it (PC2, clubhouse display, etc.)${
          needsTemplatePush ? ' - the colour change within about 15 seconds, the template change immediately.' : ' within about 15 seconds.'
        }`
      : `Apply this design to the ${screenLabel}? This updates the shared colour theme everywhere it's used${
          needsTemplatePush ? ", and switches this screen's own layout template" : ''
        } - devices pick up the colour change within about 15 seconds${needsTemplatePush ? ', the template change immediately' : ''}.`

    if (!window.confirm(confirmMessage)) {
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
            slug: isDashboard ? 'main' : 'cafe-tv',
            name: targetDisplay?.name ?? (isDashboard ? 'Main Dashboard' : 'Clubhouse Cafe TV'),
            templateId: pendingTemplateId,
            panelConfig: targetDisplay?.panelConfig ?? (isDashboard ? { weather: true, compass: true, media: true, ops: true } : null),
          }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          setApplyStatus('error')
          return
        }
        const nextDisplay = { name: data.name, templateId: data.templateId, panelConfig: data.panelConfig }
        if (isDashboard) setMainDisplay(nextDisplay)
        else setCafeDisplay(nextDisplay)
      }
      setApplyStatus('success')
    } catch {
      setApplyStatus('error')
    }
  }

  function handleExport() {
    const activeTemplate = allTemplates.find((t) => t.id === selectedId)
    const exportName = activeTemplate?.name ?? 'Untitled Theme'
    const blob = new Blob([JSON.stringify({ name: exportName, tokens: activeTokens, gradientMode: activeGradientMode }, null, 2)], {
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
        const gradientMode = parsed.gradientMode === 'solid' ? 'solid' : 'gradient'
        const next: DesignTemplate = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          tokens: parsed.tokens,
          gradientMode,
          createdAt: new Date().toISOString(),
        }
        persistTemplates([...templates, next])
        setActiveTokens(next.tokens)
        setActiveGradientMode(gradientMode)
        setSelectedId(next.id)
        setImportError(null)
      } catch {
        setImportError('That file is not valid JSON - nothing was imported.')
      }
    }
    reader.readAsText(file)
  }

  const previewStyle = Object.fromEntries(DESIGN_TOKEN_KEYS.map((key) => [key, activeTokens[key]])) as CSSProperties
  const activeTokenGroup = TOKEN_GROUPS.find((group) => group.id === activeTab)

  return (
    // v1's outer wrapper pinned this whole page to exactly one viewport
    // height (min-[1800px]:h-screen + overflow-hidden), with the preview
    // pane never scrolling and only the tabs content area scrolling
    // internally. That doesn't fit v2's shape: a permanent full-width
    // footer below the two-column body has nowhere to go inside a
    // viewport-height-locked page without either clipping it entirely or
    // stealing height from the body above it. Dropped in favour of the
    // page just scrolling normally (confirmed across this round's mockup
    // iterations) - the left rail's own content and the footer both sit
    // in normal document flow now, not pinned/internally-scrolled panes.
    <div className="mx-auto max-w-[1900px] px-6 py-6">
      {/* Single header row: title + info icon on the left, toggle on the
          right - the paragraph that used to sit below the title, and the
          toggle's own row above the preview, are both gone; their content
          either moved into the info popover (paragraph) or up onto this
          row (toggle), which is what lets the preview below start right
          under this row instead of two rows further down. */}
      {/* Stacks by default (title+icon row, then toggle below) and only
          goes side-by-side at the same min-[1200px] threshold the
          preview/tabs split already uses - deliberately NOT relying on
          flex-wrap's automatic content-width wrapping here. This page's
          `html { font-size: clamp(12px, 1.5vmin, 20px) }` global (see
          index.css) makes every rem-based Tailwind class viewport-height-
          dependent as well as width-dependent, which makes hand-computed
          "does this fit at Npx" math unreliable - confirmed the hard way,
          this row previously overflowed off-canvas at a normal 1568px
          laptop width despite looking like it should have had room to
          spare. An explicit min-width breakpoint sidesteps that entirely:
          Tailwind's breakpoints key off actual viewport width in CSS px,
          not the rem-scaled content, so "stacked below 1800px" is true
          regardless of how large the clamp() pushes rem sizing. */}
      <div className="mb-6 flex flex-shrink-0 flex-col items-start gap-3 min-[1200px]:flex-row min-[1200px]:items-center min-[1200px]:justify-between min-[1200px]:gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-black uppercase tracking-wide text-primary">Screens Design</h1>
          <div ref={infoRef} className="relative">
            <button
              type="button"
              onClick={() => setInfoOpen((open) => !open)}
              aria-label="About this page"
              aria-expanded={infoOpen}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-bold text-muted-500 transition hover:border-accent-sky-500 hover:text-accent-sky-400"
            >
              i
            </button>
            {infoOpen && (
              // top-full + mt-2 anchors this below the icon, not overlapping
              // the title/toggle row at all; z-20 keeps it above the preview
              // and tab panel below. Deliberately NOT centered/wide enough
              // to also spill under the right-aligned toggle at typical
              // widths - w-80 (320px) starting from the icon's own left
              // edge stays within the title's side of the row.
              <div className="absolute left-0 top-full z-20 mt-2 w-80 rounded-lg border border-border bg-slate-900 p-4 shadow-xl">
                <button
                  type="button"
                  onClick={() => setInfoOpen(false)}
                  aria-label="Close"
                  className="absolute right-2 top-2 text-sm leading-none text-muted-500 hover:text-primary"
                >
                  ×
                </button>
                <p className="pr-4 text-sm text-muted-400">
                  Experiment freely - the preview reacts to the colours you pick, and nothing is saved until you
                  choose to. When you're ready, use "Apply to live screen" above to push a theme
                  (and, on Café, the current template) to every device that loads the real{' '}
                  {activeScreen === 'dashboard' ? 'dashboard' : 'café screen'}.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
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

          {/* Pinned here (this row renders regardless of which tab is
              active below) rather than duplicated into Backgrounds/
              Custom/Text/Accent & Status separately - all four edit the
              same activeTokens state, so one reachable-from-anywhere
              button is simpler than four copies of the same handler.
              Previously only existed inside Backgrounds > Templates,
              which meant editing colour in any OTHER tab left no visible
              way to actually publish it without first switching tabs.
              Same handleApplyToLiveScreen/confirm()/15-second-
              propagation behaviour as always - only the location and
              label changed, not the safety gate itself. */}
          <button
            type="button"
            onClick={handleApplyToLiveScreen}
            disabled={applyStatus === 'working'}
            className="shrink-0 rounded-lg border border-accent-sky-500 bg-slate-900/80 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-200 transition hover:bg-accent-sky-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applyStatus === 'working' ? 'Applying…' : 'Apply to live screen'}
          </button>
        </div>
      </div>
      {applyStatus === 'success' && (
        <p className="-mt-4 mb-6 text-sm font-semibold text-status-good">✅ Applied - devices will pick it up shortly.</p>
      )}
      {applyStatus === 'error' && (
        <p className="-mt-4 mb-6 text-sm font-semibold text-status-bad">❌ Could not apply - check connectivity and try again.</p>
      )}

      {/* TWO-COLUMN BODY: left rail (~34%, nav + inline expanded section)
          | right column (~66%, preview only). items-start (not stretch)
          so each column sizes to its own content - the left rail and the
          fixed-size preview box are rarely the same height, and forcing
          them equal would either stretch the rail's border oddly or
          crop the preview. Reuses the same min-[1200px] breakpoint the
          rest of this page already keys off (see that breakpoint's own
          comment above) rather than a new threshold - below it, the rail
          renders first, preview second, stacked, exactly the "collapses
          back to its current below-preview position" fallback asked
          for. */}
      <div className="flex flex-col gap-6 min-[1200px]:flex-row min-[1200px]:items-start">
        {/* LEFT RAIL - nav list + whichever section is selected, expanded
            inline directly below it. Replaces v1's wide horizontal-space
            tabs pane; single column now (~34% of a much narrower row),
            so every section's own controls below render one per row, not
            the multi-column grids v1 used - those don't fit a rail this
            narrow. */}
        <div className="w-full flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-panel min-[1200px]:w-[34%]">
          <nav className="flex flex-col gap-1 border-b border-border p-3">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide transition ${
                  activeTab === tab.id ? 'bg-accent-sky-500/15 text-accent-sky-400' : 'text-muted-400 hover:bg-slate-900/60 hover:text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="p-5">
            {activeTab === 'branding' && (
              <div>
                <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Branding</div>
                {/* Always stacked now (was sm:flex-row, side-by-side name
                    + logo above the sm breakpoint) - that breakpoint keys
                    off the VIEWPORT's own width, not this rail's, so on a
                    genuinely wide device it would still try to go
                    side-by-side inside a rail that's only ~34% of the
                    page - forced single-column per this round's own
                    "one control per row" requirement. */}
                <div className="flex flex-col gap-6">
                  <div>
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

                  <div>
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

                  {/* Logo/name display - migration 0039. Root cause: a real
                      club logo (e.g. Shobdon's own) often already has the
                      club name baked into the artwork, so showing a
                      separate text label right next to it reads as
                      redundant/cluttered rather than a genuine CSS overlap
                      (confirmed via Playwright: the two elements never
                      actually collide in the DOM) - but for any tenant
                      whose logo does NOT bake in their name, two
                      independently-checkable boxes could produce a real
                      visual overlap, which is what this round's radio-style
                      rework prevents structurally rather than relying on
                      an admin noticing. Two independent groups, not one
                      shared control - the main Dashboard and the Café
                      display are different physical screens that may need
                      different answers (e.g. logo on the dashboard, name
                      text on the café screen). Within each group, exactly
                      one of the two is ever true - selected below by
                      deriving it from value.showLogo rather than trusting
                      both fields independently, so a legacy row with both
                      (or neither) true/false still renders exactly one
                      radio selected instead of a browser-dependent
                      double-checked group. */}
                  {(
                    [
                      { key: 'main' as const, label: 'Main Dashboard', value: brandMain, setValue: setBrandMain },
                      { key: 'cafe' as const, label: 'Café Display', value: brandCafe, setValue: setBrandCafe },
                    ]
                  ).map(({ key, label, value, setValue }) => (
                    <div key={key}>
                      <label className="mb-2 block text-xs uppercase tracking-wide text-muted-400">{label}</label>
                      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                        <label className="flex items-center gap-2 text-sm text-primary">
                          <input
                            type="radio"
                            name={`brand-display-${key}`}
                            checked={value.showLogo}
                            onChange={() => {
                              const next = { ...value, showLogo: true, showName: false }
                              setValue(next)
                              handleSaveBrandDisplay(key === 'main' ? next : brandMain, key === 'cafe' ? next : brandCafe)
                            }}
                          />
                          Show logo
                        </label>
                        <label className="flex items-center gap-2 text-sm text-primary">
                          <input
                            type="radio"
                            name={`brand-display-${key}`}
                            checked={!value.showLogo}
                            onChange={() => {
                              const next = { ...value, showLogo: false, showName: true }
                              setValue(next)
                              handleSaveBrandDisplay(key === 'main' ? next : brandMain, key === 'cafe' ? next : brandCafe)
                            }}
                          />
                          Show brand name text
                        </label>
                        <label className="flex items-center justify-between gap-2 text-sm text-primary">
                          <span>Name size</span>
                          <select
                            value={value.nameFontSize}
                            onChange={(event) => {
                              const next = { ...value, nameFontSize: event.target.value as BrandDisplaySettings['nameFontSize'] }
                              setValue(next)
                              handleSaveBrandDisplay(key === 'main' ? next : brandMain, key === 'cafe' ? next : brandCafe)
                            }}
                            className="rounded border border-border bg-slate-900 px-2 py-1 text-xs text-primary"
                          >
                            <option value="sm">Small</option>
                            <option value="md">Medium</option>
                            <option value="lg">Large</option>
                            <option value="xl">Extra large</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                  {brandSaveStatus === 'success' && <p className="text-xs text-status-good">Saved.</p>}
                  {brandSaveStatus === 'error' && <p className="text-xs text-status-bad">Couldn't save - please try again.</p>}
                </div>
              </div>
            )}

            {/* Backgrounds / Text / Accent & Status - single-column swatch
                rows (was a multi-column auto-fill grid in v1, sized for
                a much wider pane than this rail has). Shared row markup
                with the Custom section below, not a separate component -
                small enough that extracting one felt like more
                indirection than the four lines it would save. */}
            {activeTokenGroup && (
              <div>
                <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{activeTokenGroup.title}</div>
                <div className="flex flex-col gap-1">
                  {activeTokenGroup.keys.map((key) => (
                    <ColorField
                      key={key}
                      label={labelFor(key)}
                      value={activeTokens[key]}
                      onChange={(hex) => handleTokenChange(key, hexToRgbaPreservingAlpha(hex, activeTokens[key]))}
                      toHex={rgbaToHex}
                      savedSwatches={savedSwatches}
                      onCaptureSwatch={() => handleCaptureSwatch(rgbaToHex(activeTokens[key]))}
                      onClearSwatch={handleClearSwatch}
                    />
                  ))}
                </div>
                {swatchError && <p className="mt-2 text-xs font-semibold text-status-bad">Couldn't save swatch - please try again.</p>}
              </div>
            )}

            {activeTab === 'backgrounds' && (
              <div>
                {/* Templates and Custom used to be separate top-level
                    nav items (7 total) - merged here per instruction,
                    since they "fundamentally edit the same thing... just
                    via different UIs." This heading row's own toggle
                    (Templates/Custom) swaps which of the two sub-views
                    renders below; the "Templates" heading text itself is
                    unchanged, left exactly as it read before. */}
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="text-sm font-bold uppercase tracking-widest text-accent-sky-400">Templates</div>
                  <div className="inline-flex gap-1 rounded-lg border border-border bg-slate-900/60 p-1">
                    {(['templates', 'custom'] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setBackgroundsView(view)}
                        className={`rounded-md px-3 py-1 text-xs font-bold capitalize transition ${
                          backgroundsView === view ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-primary'
                        }`}
                      >
                        {view}
                      </button>
                    ))}
                  </div>
                </div>

                {backgroundsView === 'templates' ? (
                  <>
                    {/* BASE COLOUR FILTER - ready for the ~30-preset import
                        task landing separately; today only the two built-in
                        templates (Current Live Theme, Bright Blue) are
                        tagged, so most chips fall back to an on-the-fly
                        preview generated from that chip's own anchor colour
                        (deriveBackgroundTokensFromAnchor) instead of
                        matching a real saved template - see
                        handleSelectBaseColourChip's own comment. Clicking
                        the already-active chip again clears the filter back
                        to "show every template" rather than needing a
                        separate Clear button. flex-wrap: all 13 chips render
                        (was truncated at the first 4 during mockup iteration
                        - fixed there before this ever reached real code),
                        wrapping across as many rows as this narrower rail
                        needs. */}
                    <div className="mb-4 flex flex-wrap gap-2">
                      {BASE_COLOUR_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleSelectBaseColourChip(option.id)}
                          title={option.label}
                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition ${
                            baseColourFilter === option.id ? 'border-accent-sky-500 bg-slate-900' : 'border-border bg-slate-900/80 hover:border-accent-sky-500/60'
                          }`}
                        >
                          <span className="h-3 w-3 shrink-0 rounded-full border border-white/20" style={{ background: option.swatch }} />
                          {option.label}
                        </button>
                      ))}
                      {baseColourFilter && (
                        <button
                          type="button"
                          onClick={() => setBaseColourFilter(null)}
                          className="rounded-full border border-border bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-muted-400 transition hover:border-accent-sky-500/60 hover:text-white"
                        >
                          Clear filter
                        </button>
                      )}
                    </div>

                    {/* SOLID / GRADIENT - background fill for the Page/Header
                        slots. Part of DesignTemplate (gradientMode), not
                        session-only: saving, exporting, importing, and
                        duplicating a template all carry this choice with it
                        (see handleSaveAsTemplate/handleDuplicate/handleExport/
                        handleImportFile). Affects this page's own preview
                        immediately (Header.tsx and the Café preview's page
                        background both read it) - does NOT yet affect the
                        real live dashboard/café templates when applied
                        (ClassicTemplate.tsx, CafeTemplate.tsx, Clubhouse1/2
                        Template.tsx all still render the gradient
                        unconditionally) - flagged explicitly, not silently
                        left half-done: wiring gradientMode into those is a
                        separate, larger change touching every display
                        template, out of this round's scope. */}
                    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-slate-900/60 px-3 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-400">Background fill</span>
                      <div className="inline-flex gap-1 rounded-lg border border-border bg-slate-950/60 p-1">
                        {(['solid', 'gradient'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setActiveGradientMode(mode)}
                            className={`rounded-md px-3 py-1 text-xs font-bold capitalize transition ${
                              activeGradientMode === mode ? 'bg-accent-sky-500 text-white' : 'text-muted-400 hover:text-primary'
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    <ul className="mb-4 flex flex-col gap-2">
                      {visibleTemplates.length === 0 && (
                        <li className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-500">
                          No templates tagged "{BASE_COLOUR_OPTIONS.find((o) => o.id === baseColourFilter)?.label}" yet.
                        </li>
                      )}
                      {visibleTemplates.map((template) => (
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
                            // Clicking a template row updates the live preview
                            // immediately - handleSelectTemplate below sets
                            // activeTokens/activeGradientMode, which the
                            // preview already renders from on every render,
                            // completely independent of "Apply" further down
                            // (that's the only action that touches the real,
                            // live dashboard).
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

                    {/* "Save as new template" lives on the Custom sub-view
                        now (see below) - Export/Import stay here since
                        they're file-based, not part of the colour-editing
                        flow. Apply itself moved to the persistent header
                        row (next to the Dashboard/Cafe toggle) so it's
                        reachable from every tab that edits activeTokens,
                        not just this one. */}
                    <div className="flex flex-wrap items-center gap-3">
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
                    {importError && <p className="mt-4 text-sm font-semibold text-status-bad">⚠️ {importError}</p>}
                  </>
                ) : (
                  <>
                    {/* CUSTOM sub-view - the raw swatch editor, originally
                        the standalone Backgrounds tab's own content, then
                        briefly its own standalone "Custom" tab, now this
                        toggle's second state. Same activeTokens/nameInput
                        state the template browser above and Save-as-
                        template both use - not a separate copy. */}
                    <div className="flex flex-col gap-1">
                      {BACKGROUND_TOKEN_KEYS.map((key) => (
                        <ColorField
                          key={key}
                          label={labelFor(key)}
                          value={activeTokens[key]}
                          onChange={(hex) => handleTokenChange(key, hexToRgbaPreservingAlpha(hex, activeTokens[key]))}
                          toHex={rgbaToHex}
                          savedSwatches={savedSwatches}
                          onCaptureSwatch={() => handleCaptureSwatch(rgbaToHex(activeTokens[key]))}
                          onClearSwatch={handleClearSwatch}
                        />
                      ))}
                    </div>
                    {swatchError && <p className="mt-2 text-xs font-semibold text-status-bad">Couldn't save swatch - please try again.</p>}

                    <div className="mt-5 border-t border-border pt-4">
                      <label className="mb-1.5 block text-xs uppercase tracking-wide text-muted-400">Save as new template</label>
                      <div className="flex flex-col gap-2">
                        <input
                          value={nameInput}
                          onChange={(event) => setNameInput(event.target.value)}
                          placeholder="Template name"
                          className="rounded-lg border border-border bg-slate-900 px-3 py-2 text-sm text-primary"
                        />
                        <button
                          type="button"
                          onClick={handleSaveAsTemplate}
                          disabled={!nameInput.trim()}
                          className="rounded-lg border border-border bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-accent-sky-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save as template
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'your-displays' && (
              <div>
                <div className="mb-4 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Your Displays</div>
                <DisplayUrlList />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN - preview only, no longer sharing this side of
            the page with a separate panel (v1's Quick Colours pane sat
            here too) - the freed space plus PREVIEW_DISPLAY_WIDTH's own
            increase (800 -> 920, see that constant's own comment) is
            what makes this read as the page's visual centerpiece rather
            than a small box floating in empty space. justify-center
            below the breakpoint (viewport-width-driven, may be narrower
            than the preview's own natural size), flex-start above it
            (this column has real room, no need to center within it). */}
        <div className="flex min-w-0 flex-1 justify-center min-[1200px]:justify-start">
          {/* Rendered at the real 1920x1080 reference size (matching
              DashboardPage.tsx's own layout, or CafeTemplate.tsx's own
              layout, exactly), then scaled down as one unit via
              transform - not squeezed into a shorter box - so every
              element stays proportionally correct instead of being
              clipped. Which inner layout renders is the only thing the
              toggle changes - the outer scaled wrapper, WeatherProvider,
              and previewStyle CSS variables are shared by both. */}
          {/* flex-shrink-0: without this, this flex item's own default
              shrink behaviour let the browser render it NARROWER than
              its own explicit width style under space pressure near the
              breakpoint's minimum trigger width - confirmed directly via
              measurement (581-588px rendered vs the 640px specified at
              1200-1210px). That's silent content clipping, not a
              harmless resize: the inner canvas below is scaled by
              PREVIEW_SCALE, a fixed JS constant computed from this exact
              width, with no knowledge that flexbox shrank its own
              container - the scaled content stays full width while the
              clipping box around it shrinks, cropping the preview's
              right edge with no visual indication anything was cut off. */}
          <div
            className="flex-shrink-0 overflow-hidden rounded-2xl border border-border"
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
                  // Dispatches on pendingMainId (the STAGED selection, not
                  // necessarily live yet) to the exact same real template
                  // components DashboardPage.tsx itself renders - a genuine
                  // preview of what Apply would actually publish, not a
                  // fixed Clubhouse-1-shaped lookalike regardless of which
                  // card is selected. isPreview on each makes them size to
                  // this scaled box instead of the real viewport (see each
                  // component's own comment). activeGradientMode (the
                  // Solid/Gradient preview toggle) isn't threaded through
                  // here - confirmed in an earlier round that it was
                  // already never applied to the real live dashboard
                  // either way (template-library-only, dead outside this
                  // page's own preview), so this isn't a live-behaviour
                  // regression, just a cosmetic preview-only detail that
                  // stops applying once a genuine template renders.
                  pendingMainId === 'clubhouse-2' ? (
                    <Clubhouse2Template
                      themeOverride={previewStyle}
                      airfieldName={airfieldName}
                      logoUrl={logoUrl}
                      showLogo={brandMain.showLogo}
                      showName={brandMain.showName}
                      nameFontSize={brandMain.nameFontSize}
                      isPreview
                    />
                  ) : pendingMainId === 'cafe-1' ? (
                    <CafeTemplate
                      themeOverride={previewStyle}
                      airfieldName={airfieldName}
                      logoUrl={logoUrl}
                      showLogo={brandMain.showLogo}
                      showName={brandMain.showName}
                      nameFontSize={brandMain.nameFontSize}
                      isPreview
                    />
                  ) : (
                    <Clubhouse1Template
                      themeOverride={previewStyle}
                      airfieldName={airfieldName}
                      logoUrl={logoUrl}
                      showLogo={brandMain.showLogo}
                      showName={brandMain.showName}
                      nameFontSize={brandMain.nameFontSize}
                      isPreview
                    />
                  )
                ) : (
                  <CafePreview airfieldName={airfieldName} logoUrl={logoUrl} gradientMode={activeGradientMode} brandCafe={brandCafe} />
                )}
              </WeatherProvider>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER - "Layout - Dashboard/Café screen" (the Clubhouse/Café
          template-slot picker), moved out of the Templates section
          entirely and into a permanent, full-width block below the
          two-column body. Always rendered regardless of activeTab -
          selecting Branding/Backgrounds/Custom/anything else in the
          left rail never hides this. isActive's highlight still follows
          the Dashboard/Café toggle in the header row above; both
          "Active on Dashboard"/"Active on Café" badges stay independent
          of it, showing ground truth for BOTH screens regardless of
          which one is toggled - unchanged from v1. Apply itself doesn't
          live here either - it's pinned in the header row next to that
          same toggle now (reachable from every tab, not just one) - this
          card's own layout-slot cards already apply their own selection
          instantly on click regardless, so nothing here depended on it. */}
      <div className="mt-6 rounded-2xl border border-border bg-panel p-6">
        <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
          Layout - {activeScreen === 'dashboard' ? 'Dashboard' : 'Café'} screen
        </div>
        <p className="mb-4 text-xs text-muted-500">
          Choose which layout renders on the screen selected above - the preview reacts immediately, but nothing
          is live until you click "Apply to live screen".
        </p>
        <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {TEMPLATE_SLOTS.map((slot) => {
            const toggledScreenLiveId = activeScreen === 'dashboard' ? activeTemplateId : cafeActiveTemplateId
            const isPendingSelection = slot.id === pendingIdForToggledScreen
            const isActiveOnDashboard = slot.id === activeTemplateId
            const isActiveOnCafe = cafeActiveTemplateId !== null && slot.id === cafeActiveTemplateId
            const isPendingNotYetLive = isPendingSelection && slot.id !== toggledScreenLiveId
            const isComingSoon = slot.status === 'coming-soon'
            return (
              <button
                key={slot.id}
                type="button"
                disabled={isComingSoon}
                onClick={() => handleSelectLayoutTemplate(slot.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  isComingSoon
                    ? 'cursor-not-allowed border-border bg-slate-900/40 opacity-50'
                    : isPendingSelection
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
                {/* Distinct colour (status-warn, not the same accent-sky-400
                    "Active on..." uses) - this card is only SELECTED for
                    preview/pending-apply, genuinely different from actually
                    live, and needs to read as unambiguous at a glance. */}
                {isPendingNotYetLive && (
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-status-warn">Selected - not yet live</div>
                )}
                {isComingSoon && <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-500">Coming soon</div>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
