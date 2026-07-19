// Café ticker style presets - built-in bundles plus a tenant's own saved
// custom ones. Deliberately mirrors designTemplateStore.ts's exact shape
// (built-in constants + loadX/saveX localStorage helpers) rather than
// inventing a second convention for "a named bundle of style properties
// you can save/reapply". Custom templates are personal/browser-local
// (like the colour theme templates), not server-synced - the CURRENTLY
// ACTIVE style (whichever preset was last applied, then possibly
// further adjusted) is what's server-persisted, in cafe_template_settings
// itself, since that's what the live public dashboard actually reads.

export interface TickerStyle {
  backgroundColor: string
  // 0-100
  backgroundOpacity: number
  heightPx: number
  fontFamily: 'Inter' | 'Montserrat' | 'Oswald'
  fontSizePx: number
  fontColor: string
  // px/second the content scrolls at. 0 = static (no animation, no
  // duplicated track) - the deliberately-sufficient stand-in for a
  // separate "static mode" toggle.
  scrollSpeedPxPerSec: number
}

export interface TickerStyleTemplate {
  id: string
  name: string
  style: TickerStyle
  createdAt: string
}

// Today's implicit hard-coded look (bg-panel/text-primary/font-semibold
// text-base, ~30s sweep) translated into explicit values - the starting
// point before any preset or custom adjustment is applied, and what a
// freshly-migrated tenant's cafe_template_settings row defaults to.
export const DEFAULT_TICKER_STYLE: TickerStyle = {
  backgroundColor: '#0f172a',
  backgroundOpacity: 100,
  heightPx: 64,
  fontFamily: 'Inter',
  fontSizePx: 16,
  fontColor: '#ffffff',
  scrollSpeedPxPerSec: 80,
}

const now = '2026-07-19T00:00:00.000Z'

export const BUILT_IN_TICKER_PRESETS: TickerStyleTemplate[] = [
  {
    id: 'preset-news',
    name: 'News Style',
    createdAt: now,
    style: {
      backgroundColor: '#7f1d1d',
      backgroundOpacity: 100,
      heightPx: 64,
      fontFamily: 'Oswald',
      fontSizePx: 18,
      fontColor: '#ffffff',
      scrollSpeedPxPerSec: 100,
    },
  },
  {
    id: 'preset-christmas',
    name: 'Christmas Style',
    createdAt: now,
    style: {
      backgroundColor: '#14532d',
      backgroundOpacity: 100,
      heightPx: 64,
      fontFamily: 'Montserrat',
      fontSizePx: 16,
      fontColor: '#fde68a',
      scrollSpeedPxPerSec: 60,
    },
  },
  {
    id: 'preset-summer',
    name: 'Summer Design',
    createdAt: now,
    style: {
      backgroundColor: '#0ea5e9',
      backgroundOpacity: 85,
      heightPx: 64,
      fontFamily: 'Inter',
      fontSizePx: 16,
      fontColor: '#ffffff',
      scrollSpeedPxPerSec: 70,
    },
  },
  {
    id: 'preset-business',
    name: 'Business Design',
    createdAt: now,
    style: {
      backgroundColor: '#0f172a',
      backgroundOpacity: 100,
      heightPx: 56,
      fontFamily: 'Inter',
      fontSizePx: 15,
      fontColor: '#e2e8f0',
      scrollSpeedPxPerSec: 65,
    },
  },
]

const STORAGE_KEY = 'shobdon-central.cafe-ticker-style-templates.v1'

export function loadTickerStyleTemplates(): TickerStyleTemplate[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTickerStyleTemplates(templates: TickerStyleTemplate[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function isValidTickerStyle(value: unknown): value is TickerStyle {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.backgroundColor === 'string' &&
    typeof v.backgroundOpacity === 'number' &&
    typeof v.heightPx === 'number' &&
    typeof v.fontFamily === 'string' &&
    typeof v.fontSizePx === 'number' &&
    typeof v.fontColor === 'string' &&
    typeof v.scrollSpeedPxPerSec === 'number'
  )
}
