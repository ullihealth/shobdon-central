import type { CSSProperties } from 'react'

// Shared shape + style-builder for /pilot's independent mobile theme
// override (migration 0085, extended over the last two rounds with
// compass/info-panel/text colours) - extracted so PilotViewPage.tsx (the
// real page) and PilotPanelPage.tsx's own live preview build the exact
// same style object from the exact same override, rather than two
// hand-maintained copies that could silently drift apart. Previously
// PilotViewPage.tsx had this logic inline, un-shared - the preview
// round is what surfaced the duplication risk, per the explicit
// "preview and reality shouldn't diverge" requirement.
export interface PilotThemeOverride {
  backgroundColor: string
  compassDiscBg?: string
  compassRing?: string
  compassCardinal?: string
  compassMarkers?: string
  panelBg?: string
  cardBg?: string
  textColor?: string
}

// Compass/info-panel colours (compassDiscBg/panelBg/cardBg) each stay
// completely absent from this style object when unset, rather than
// being filled with a guessed default - CSS custom properties left
// unset here simply keep resolving through to :root's own real defaults
// (src/index.css), which IS today's exact hardcoded appearance, not an
// approximation of it. compassRing/compassCardinal/compassMarkers/
// cardinalTextColor aren't CSS variables at all (see CompassPanel.tsx's
// own comment on why) - callers pass those as explicit props at their
// own <CompassPanel> call site instead, same "undefined omits it
// entirely" behaviour via that component's own default parameters.
export function buildPilotThemeStyle(override: PilotThemeOverride | null): CSSProperties | undefined {
  if (!override) return undefined
  return {
    backgroundColor: override.backgroundColor,
    ...(override.compassDiscBg ? { '--color-compass-disc-bg': override.compassDiscBg } : {}),
    ...(override.panelBg ? { '--color-panel-bg': override.panelBg } : {}),
    ...(override.cardBg ? { '--color-card-bg': override.cardBg } : {}),
    // Sets BOTH the wrapper's own inherited `color` (reaches any plain
    // text below that doesn't set its own) and --color-text-primary
    // (reaches text-primary specifically) - two different mechanisms
    // because plain inherited text and Tailwind's text-primary utility
    // resolve colour two different ways, and both need to move together
    // for this to look intentional.
    ...(override.textColor ? { color: override.textColor, '--color-text-primary': override.textColor } : {}),
  } as CSSProperties
}
