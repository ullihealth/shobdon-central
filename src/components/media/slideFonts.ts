// Curated, tenant-agnostic font list for the slide composer. Three
// system stacks (zero loading cost, always available) plus three
// self-hosted OFL-1.1-licensed Google Fonts via @fontsource - OFL
// permits embedding/redistributing the font freely (including baking
// rendered text into an exported image) with no attribution
// requirement; it only restricts selling the font FILES on their own,
// which bundling them into this app's build is not. Self-hosted as
// static files (not a live fonts.googleapis.com call) so the editor
// has no external network dependency and works identically for every
// future tenant, not just this one.
//
// Only weights 400/700 are loaded (regular/bold) - italic is left to
// the browser's synthetic (algorithmically slanted) rendering rather
// than loading true-italic font files too, to keep the asset list
// small. This is standard, visually reasonable browser behaviour, not
// a missing feature.
import '@fontsource/inter/400.css'
import '@fontsource/inter/700.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/700.css'
import type { SlideFontFamily, SlideRecipe } from '../../types/slideRecipe'

export const SLIDE_FONT_OPTIONS: { value: SlideFontFamily; label: string }[] = [
  { value: 'system-sans', label: 'System Sans-Serif' },
  { value: 'system-serif', label: 'System Serif' },
  { value: 'system-mono', label: 'System Monospace' },
  { value: 'inter', label: 'Inter' },
  { value: 'montserrat', label: 'Montserrat' },
  { value: 'oswald', label: 'Oswald' },
]

// The actual CSS font-family value used both for Fabric text objects
// and anywhere else this needs to resolve to a real stack.
export const SLIDE_FONT_CSS_STACK: Record<SlideFontFamily, string> = {
  'system-sans': 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  'system-serif': 'Georgia, "Times New Roman", serif',
  'system-mono': 'ui-monospace, Menlo, Consolas, monospace',
  inter: 'Inter, sans-serif',
  montserrat: 'Montserrat, sans-serif',
  oswald: 'Oswald, sans-serif',
}

// The 3 self-hosted families actually need a real network fetch the
// first time they're used - the 3 system stacks never do (no
// @font-face involved at all, so there's nothing to "load").
const LOADED_FONT_FAMILIES = new Set<SlideFontFamily>(['inter', 'montserrat', 'oswald'])

// CRITICAL for the flatten step: canvas.toDataURL() paints text with
// whatever font is ALREADY loaded at the moment it's called - if a
// self-hosted font hasn't finished downloading yet, the browser
// silently substitutes a fallback and toDataURL() bakes that
// substitution permanently into the exported PNG, with no error or
// warning. document.fonts.ready alone is not sufficient: it only
// resolves once every font load the browser has already STARTED
// completes - if a font was never actually requested (e.g. it's
// selected in the recipe but no visible DOM text has triggered the
// browser to fetch it yet), fonts.ready can resolve immediately
// without that font ever loading. So every font/weight combination
// actually used in the recipe is explicitly requested via
// document.fonts.load() first, and only THEN is document.fonts.ready
// awaited as a final safety net.
export async function ensureSlideFontsLoaded(recipe: SlideRecipe): Promise<void> {
  const requests = new Set<string>()
  for (const box of recipe.textBoxes) {
    if (!LOADED_FONT_FAMILIES.has(box.fontFamily)) continue
    const weight = box.bold ? '700' : '400'
    const cssStack = SLIDE_FONT_CSS_STACK[box.fontFamily]
    requests.add(`${weight} ${Math.round(box.fontSize)}px ${cssStack}`)
  }
  await Promise.all(Array.from(requests).map((spec) => document.fonts.load(spec)))
  await document.fonts.ready
}
