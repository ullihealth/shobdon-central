// Shared shape for tenant_displays.panel_config (migration 0027) across
// every template component - which top-level sections a given named
// display should render. Not every template honours every key (e.g.
// CafeTvTemplate has no slot for `compass` at all) - a template is free
// to ignore keys that don't apply to its own layout.
export interface DisplayPanelConfig {
  weather: boolean
  compass: boolean
  media: boolean
  ops: boolean
}

export const DEFAULT_PANEL_CONFIG: DisplayPanelConfig = {
  weather: true,
  compass: true,
  media: true,
  ops: true,
}

// Defensive against a missing/partial/malformed panel_config (e.g. a
// tenant_displays row inserted by hand via the admin endpoint with only
// some keys set) - unspecified keys default to visible, matching the
// "nothing changes unless deliberately configured" intent of migration
// 0027's own seed data.
export function normalizePanelConfig(raw: unknown): DisplayPanelConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<DisplayPanelConfig>
  return {
    weather: source.weather ?? true,
    compass: source.compass ?? true,
    media: source.media ?? true,
    ops: source.ops ?? true,
  }
}
