// The editable "recipe" behind a composer-generated slide - background +
// positioned text boxes. Deliberately NOT Fabric.js's native canvas.toJSON()
// shape: this stays a small, explicit, library-independent type so the
// stored data in media_library.slideRecipeJson never depends on which
// canvas library the editor happens to use. SlideEditor.tsx is the only
// place that translates between this shape and actual Fabric objects.
//
// Coordinates are in fixed canvas pixels (canvasWidth x canvasHeight,
// currently always 1920x1080) rather than percentages - the canvas is
// always flattened to one fixed target resolution, so absolute pixel
// coordinates are simpler and match how Fabric's own object model
// already works, with no percent<->pixel conversion needed anywhere.
export interface SlideRecipe {
  canvasWidth: number
  canvasHeight: number
  background: SlideBackground
  // Layered images (e.g. a headshot on top of a background photo) -
  // rendered in array order, between the background and the text boxes
  // (see SlideEditor.tsx: objects are added to the Fabric canvas in the
  // same order they appear here, and Fabric's own stacking is add-order,
  // so this array's order IS the z-order - no separate z-index field).
  images: SlideImageElement[]
  textBoxes: SlideTextBox[]
}

export type SlideBackground = { type: 'color'; color: string } | { type: 'image'; mediaLibraryId: string }

export interface SlideImageElement {
  id: string
  mediaLibraryId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface SlideTextBox {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontFamily: SlideFontFamily
  fontSize: number
  color: string
  align: 'left' | 'center' | 'right'
  bold?: boolean
  italic?: boolean
}

// Curated, tenant-agnostic font list - three always-available system
// stacks (zero loading cost) plus three self-hosted OFL-licensed
// Google Fonts (see src/lib/slideFonts.ts for the actual @font-face
// loading and the CSS font-family string each key maps to). Nothing
// here assumes any one tenant's branding.
export type SlideFontFamily = 'system-sans' | 'system-serif' | 'system-mono' | 'inter' | 'montserrat' | 'oswald'
