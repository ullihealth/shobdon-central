export interface RunwayStrip {
  colour: string
}

export interface RunwayGroup {
  id: string
  label: string // e.g. "08/26" - admin-typed text, no slash-math or auto-reciprocal
  headingDegrees: number // precise magnetic heading for the first identifier, independently editable
  twin: boolean
  strips: RunwayStrip[] // length 1 if !twin, length 2 if twin
  stripWidthPx: number // strip width in CompassPanel.tsx's internal 0-400 SVG coordinate space, shared by both strips in a twin group
  stripLengthPx: number // full strip length (along the runway's own axis), same coordinate space - CompassPanel.tsx clamps this against the cardinal-letter margin at render time
  hasThresholdMarkings: boolean // checkerboard block at each strip end, per physical strip
}

// The Club Profile concept spans three pieces of per-airfield data: colour
// tokens (designTemplateStore.ts), media source (config/media.ts), and
// runwayGroups (clubProfileStore.ts). The first two are unchanged by this
// pass and keep living in their existing homes - only runwayGroups is new.
export interface ClubProfile {
  runwayGroups: RunwayGroup[]
}
