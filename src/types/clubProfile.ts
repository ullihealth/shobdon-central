export interface RunwayStrip {
  colour: string
  widthPx: number // this strip's own width, independent of any other strip in the group (e.g. a narrower grass strip beside a wider tarmac one)
  hasThresholdMarkings: boolean // checkerboard block at each end of this specific strip - independent per strip (e.g. tarmac on, grass off)
  showIdentifierLabel: boolean // whether this strip's own identifier numbers (e.g. "08"/"26") render at both its ends - independent per strip
}

export interface RunwayGroup {
  id: string
  label: string // e.g. "08/26" - admin-typed text, no slash-math or auto-reciprocal
  headingDegrees: number // precise magnetic heading for the first identifier, independently editable
  twin: boolean
  strips: RunwayStrip[] // length 1 if !twin, length 2 if twin
  stripLengthPx: number // full strip length (along the runway's own axis), shared by every strip in the group - CompassPanel.tsx's internal 0-400 SVG coordinate space
  identifierFontSizePx: number // font size for both identifier numbers, shared by every strip in the group that has its label shown
}

// The Club Profile concept spans three pieces of per-airfield data: colour
// tokens (designTemplateStore.ts), media source (config/media.ts), and
// runwayGroups (clubProfileStore.ts). The first two are unchanged by this
// pass and keep living in their existing homes - only runwayGroups is new.
export interface ClubProfile {
  runwayGroups: RunwayGroup[]
  // Live webcam embed URL for MediaPanel (e.g. an rtsp.me embed page) -
  // empty string means no webcam configured, MediaPanel falls back to its
  // existing placeholder/currentMedia rendering. A club fact like this
  // belongs here, not in config/media.ts (a single curated promo item) or
  // designTemplateStore.ts (page theme colours).
  webcamUrl: string
}
