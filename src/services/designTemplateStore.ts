export interface DesignTokens {
  '--color-page-from': string
  '--color-page-via': string
  '--color-page-to': string
  '--color-header-from': string
  '--color-header-via': string
  '--color-header-to': string
  '--color-panel-bg': string
  '--color-card-bg': string
  '--color-border': string
  '--color-text-primary': string
  '--color-text-muted-300': string
  '--color-text-muted-400': string
  '--color-text-muted-500': string
  '--color-accent-sky-400': string
  '--color-accent-sky-500': string
  '--color-status-good-arrow': string
  '--color-status-warn-arrow': string
  '--color-status-bad-arrow': string
  '--color-status-good-text': string
  '--color-status-warn-text': string
  '--color-status-bad-text': string
  '--color-compass-fill': string
  '--color-compass-ring': string
  '--color-compass-cardinal': string
  '--color-compass-markers': string
}

export interface DesignTemplate {
  id: string
  name: string
  tokens: DesignTokens
  createdAt: string
}

const STORAGE_KEY = 'shobdon-central.design-templates.v1'

export const CURRENT_LIVE_THEME_ID = 'current-live-theme'

// Byte-identical to the :root defaults in index.css - this is "today's dashboard",
// not a guess, and is always available as a non-deletable reset option.
export const CURRENT_LIVE_THEME: DesignTemplate = {
  id: CURRENT_LIVE_THEME_ID,
  name: 'Current Live Theme',
  createdAt: '2026-07-07T00:00:00.000Z',
  tokens: {
    '--color-page-from': '#071229',
    '--color-page-via': '#081827',
    '--color-page-to': '#03101a',
    '--color-header-from': 'rgba(30, 41, 59, 0.6)',
    '--color-header-via': 'rgba(15, 23, 42, 0.5)',
    '--color-header-to': 'rgba(30, 41, 59, 0.5)',
    '--color-panel-bg': 'rgba(2, 6, 23, 0.85)',
    '--color-card-bg': 'rgba(15, 23, 42, 0.9)',
    '--color-border': '#334155',
    '--color-text-primary': '#ffffff',
    '--color-text-muted-300': '#cbd5e1',
    '--color-text-muted-400': '#94a3b8',
    '--color-text-muted-500': '#64748b',
    '--color-accent-sky-400': '#38bdf8',
    '--color-accent-sky-500': '#0ea5e9',
    '--color-status-good-arrow': '#10b981',
    '--color-status-warn-arrow': '#f59e0b',
    '--color-status-bad-arrow': '#ef4444',
    '--color-status-good-text': '#22c55e',
    '--color-status-warn-text': '#f59e0b',
    '--color-status-bad-text': '#ef4444',
    '--color-compass-fill': 'rgba(15, 23, 42, 0.95)',
    '--color-compass-ring': 'rgba(59, 130, 246, 0.25)',
    '--color-compass-cardinal': 'rgba(59, 130, 246, 0.2)',
    '--color-compass-markers': '#94a3b8',
  },
}

export const BRIGHT_BLUE_THEME_ID = 'bright-blue-preset'

// A second built-in preset alongside Current Live Theme - a vivid blue
// starting point (bold white text, cyan accent/compass ring) to be
// fine-tuned live in /design, not a finished theme.
export const BRIGHT_BLUE_THEME: DesignTemplate = {
  id: BRIGHT_BLUE_THEME_ID,
  name: 'Bright Blue',
  createdAt: '2026-07-07T00:00:00.000Z',
  tokens: {
    '--color-page-from': '#0b3d91',
    '--color-page-via': '#1450b8',
    '--color-page-to': '#0a2f6e',
    '--color-header-from': 'rgba(20, 80, 184, 0.6)',
    '--color-header-via': 'rgba(11, 61, 145, 0.5)',
    '--color-header-to': 'rgba(20, 80, 184, 0.5)',
    '--color-panel-bg': 'rgba(10, 47, 110, 0.85)',
    '--color-card-bg': 'rgba(20, 80, 184, 0.9)',
    '--color-border': '#3b82f6',
    '--color-text-primary': '#ffffff',
    '--color-text-muted-300': '#dbeafe',
    '--color-text-muted-400': '#93c5fd',
    '--color-text-muted-500': '#60a5fa',
    '--color-accent-sky-400': '#22d3ee',
    '--color-accent-sky-500': '#06b6d4',
    '--color-status-good-arrow': '#10b981',
    '--color-status-warn-arrow': '#f59e0b',
    '--color-status-bad-arrow': '#ef4444',
    '--color-status-good-text': '#22c55e',
    '--color-status-warn-text': '#f59e0b',
    '--color-status-bad-text': '#ef4444',
    '--color-compass-fill': 'rgba(11, 61, 145, 0.95)',
    '--color-compass-ring': 'rgba(34, 211, 238, 0.45)',
    '--color-compass-cardinal': 'rgba(34, 211, 238, 0.3)',
    '--color-compass-markers': '#7dd3fc',
  },
}

export const DESIGN_TOKEN_KEYS = Object.keys(CURRENT_LIVE_THEME.tokens) as (keyof DesignTokens)[]

export function loadDesignTemplates(): DesignTemplate[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDesignTemplates(templates: DesignTemplate[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function isValidDesignTokens(value: unknown): value is DesignTokens {
  if (!value || typeof value !== 'object') return false
  return DESIGN_TOKEN_KEYS.every((key) => typeof (value as Record<string, unknown>)[key] === 'string')
}
