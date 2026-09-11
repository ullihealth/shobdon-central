import type { PilotThemeOverride } from '../utils/pilotThemeStyle'

// Expanded preset-library round - a base colour (family + shade, or one
// of the four single-shade "neutrals") derives a FULL pilot theme
// programmatically, rather than every field being hand-picked per
// preset (which is how the four BUILT_IN_THEME_PRESETS in
// PilotThemeTemplatesCard.tsx were built, and stays fine for four
// hand-curated looks - this is for the roughly-24-base x ~5-text
// combinations a "match your club colours" picker needs, where hand-
// authoring every combination really would be unmaintainable). One HSL
// triple per shade, one derivation function, so every generated theme
// reads as "one designed system" rather than independently-random
// per-field colours - see deriveTheme's own comment for exactly how
// each field is derived.

export interface ColourShade {
  label: string
  h: number
  s: number
  l: number
}

export interface ColourFamily {
  id: string
  name: string
  shades: ColourShade[]
}

// Standard HSL -> #rrggbb conversion (h in degrees 0-360, s/l in 0-100).
function hsl(h: number, s: number, l: number): string {
  const sFrac = s / 100
  const lFrac = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sFrac * Math.min(lFrac, 1 - lFrac)
  const f = (n: number) => lFrac - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// The shade's own raw colour, unmodified - used for swatch previews and
// for the legibility check against a candidate text colour (both need
// the background exactly as chosen, before any of deriveTheme's own
// panel/accent derivation).
export function shadeToHex(shade: ColourShade): string {
  return hsl(shade.h, shade.s, shade.l)
}

// Five shades per family, hue/saturation held constant, lightness
// stepped light -> dark (82/62/42/26/13, chosen to read as evenly-spaced
// steps rather than an even numeric split - the darkest two steps are
// deliberately closer together, matching how perceived brightness
// compresses at the low end of the lightness scale). Green/brown use a
// lower base saturation than blue/red - at blue/red's own 65-75%
// saturation, green reads as neon/artificial and brown just reads as
// orange, both confirmed by generating and eyeballing the actual hex
// output before settling on these values, not assumed from the numbers
// alone.
export const COLOR_FAMILIES: ColourFamily[] = [
  {
    id: 'blue',
    name: 'Blue',
    shades: [
      { label: 'Sky', h: 210, s: 70, l: 82 },
      { label: 'Sea', h: 212, s: 65, l: 62 },
      { label: 'Royal', h: 215, s: 68, l: 42 },
      { label: 'Navy', h: 218, s: 55, l: 26 },
      { label: 'Midnight', h: 220, s: 45, l: 13 },
    ],
  },
  {
    id: 'red',
    name: 'Red',
    shades: [
      { label: 'Blush', h: 355, s: 75, l: 85 },
      { label: 'Coral', h: 358, s: 70, l: 65 },
      { label: 'Crimson', h: 355, s: 65, l: 45 },
      { label: 'Maroon', h: 352, s: 55, l: 28 },
      { label: 'Wine', h: 348, s: 50, l: 14 },
    ],
  },
  {
    id: 'green',
    name: 'Green',
    shades: [
      { label: 'Mint', h: 145, s: 45, l: 83 },
      { label: 'Sage', h: 145, s: 35, l: 62 },
      { label: 'Emerald', h: 150, s: 45, l: 40 },
      { label: 'Forest', h: 152, s: 40, l: 24 },
      { label: 'Pine', h: 155, s: 35, l: 12 },
    ],
  },
  {
    id: 'brown',
    name: 'Brown',
    shades: [
      { label: 'Sand', h: 30, s: 45, l: 82 },
      { label: 'Tan', h: 28, s: 42, l: 62 },
      { label: 'Caramel', h: 26, s: 45, l: 40 },
      { label: 'Coffee', h: 24, s: 42, l: 24 },
      { label: 'Espresso', h: 22, s: 38, l: 12 },
    ],
  },
  { id: 'gold', name: 'Gold', shades: [{ label: 'Gold', h: 42, s: 65, l: 50 }] },
  { id: 'silver', name: 'Silver', shades: [{ label: 'Silver', h: 210, s: 8, l: 75 }] },
  { id: 'charcoal', name: 'Charcoal', shades: [{ label: 'Charcoal', h: 220, s: 12, l: 16 }] },
  { id: 'white', name: 'White', shades: [{ label: 'White', h: 0, s: 0, l: 97 }] },
]

export const TEXT_COLOR_OPTIONS: { label: string; hex: string }[] = [
  { label: 'Black', hex: '#000000' },
  { label: 'White', hex: '#ffffff' },
  { label: 'Navy', hex: '#0f172a' },
  { label: 'Red', hex: '#dc2626' },
  { label: 'Yellow', hex: '#eab308' },
]

// WCAG relative-luminance contrast ratio (the standard formula, not the
// simpler perceptual-luminance approximation PilotPanelPage.tsx's own
// suggestedTextColorLabel hint uses - that one only needs to suggest a
// direction, this one gates what's actually selectable, so it uses the
// real spec's formula).
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA)
  const lumB = relativeLuminance(hexB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

// 3.0 = WCAG AA's own "large text" threshold (18px+, or 14px+ bold) -
// deliberately not the stricter 4.5 (normal text) since this app's own
// pilot text is consistently bold and comfortably above that size
// throughout (WeatherStatGrid's stat values, the wind readout, uppercase
// tracking-wide labels). Verified against the real generated palette
// before picking this number, not assumed - at 3.0, Swift's own real
// use case (red text on a white background, white text on a red
// background) both clear it with real margin (4.5 and 6.0 respectively
// on the Crimson/White shades), while genuinely illegible pairings
// (white-on-white, yellow-on-white, black-on-navy) correctly fall
// below it.
const CONTRAST_THRESHOLD = 3.0

export function isTextColorLegible(backgroundHex: string, textHex: string): boolean {
  return contrastRatio(backgroundHex, textHex) >= CONTRAST_THRESHOLD
}

// Every field derived from ONE base HSL triple, so a generated theme
// reads as one coherent system:
// - backgroundColor: the base colour itself, unchanged.
// - panelBg: base lightness shifted 8 points toward the dark end
//   (clamped so it can never invert past black/white) - a subtle but
//   real layering step between the page and its panels, same relationship
//   BUILT_IN_THEME_PRESETS' own hand-picked panelBg/backgroundColor pairs
//   already have (e.g. Ocean Blue's #0c2d48 background -> #08202f panel).
// - cardBg: same as backgroundColor - matches every one of the four
//   hand-picked presets, which always set these equal too.
// - compassDiscBg: same as panelBg - same match to the hand-picked
//   presets' own convention.
// - compassRing/compassCardinal: an "accent" version of the same hue -
//   pushed to a fixed, vivid lightness/saturation zone (60% lightness,
//   saturation floored at 55%) regardless of how light or dark the base
//   shade itself is, so the ring reads clearly against its own disc at
//   every shade. Neutral families (Silver/Charcoal/White, saturation
//   under 15 - hue is meaningless at s=0 anyway) get a CONTRASTING GREY
//   instead of a forced, out-of-place colour accent - lighter than the
//   base if the base is dark, darker if the base is light.
// - compassMarkers: one step softer than the ring/cardinal (lower
//   saturation, higher lightness for hued families; a smaller lightness
//   step for neutrals) - same "-300 vs -400" relationship the hand-
//   picked presets already use (e.g. Ocean Blue's ring #38bdf8 vs
//   markers #7dd3fc).
export function deriveTheme(shade: ColourShade, textColor: string): PilotThemeOverride {
  const backgroundColor = hsl(shade.h, shade.s, shade.l)
  const panelL = clamp(shade.l - 8, 3, 92)
  const panelBg = hsl(shade.h, shade.s, panelL)
  const cardBg = backgroundColor
  const compassDiscBg = panelBg

  const isNeutral = shade.s < 15
  let ringHex: string
  let markersHex: string
  if (isNeutral) {
    const ringL = shade.l > 50 ? clamp(shade.l - 35, 8, 100) : clamp(shade.l + 35, 0, 92)
    const markersL = shade.l > 50 ? clamp(shade.l - 20, 8, 100) : clamp(shade.l + 20, 0, 92)
    ringHex = hsl(shade.h, shade.s, ringL)
    markersHex = hsl(shade.h, shade.s, markersL)
  } else {
    const ringS = Math.max(shade.s, 55)
    const ringL = 60
    ringHex = hsl(shade.h, ringS, ringL)
    markersHex = hsl(shade.h, Math.max(ringS - 15, 30), clamp(ringL + 15, 0, 85))
  }

  return {
    backgroundColor,
    panelBg,
    cardBg,
    compassDiscBg,
    compassRing: ringHex,
    compassCardinal: ringHex,
    compassMarkers: markersHex,
    textColor,
  }
}
