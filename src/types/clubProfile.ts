export interface RunwayStrip {
  colour: string
  widthPx: number // this strip's own width, independent of any other strip in the group (e.g. a narrower grass strip beside a wider tarmac one)
  hasThresholdMarkings: boolean // checkerboard block at each end of this specific strip - independent per strip (e.g. tarmac on, grass off)
  showIdentifierLabel: boolean // whether this strip's own identifier numbers (e.g. "08"/"26") render at both its ends - independent per strip
  showCenterline: boolean // dashed centreline drawn along this specific strip's own axis - independent per strip (e.g. only the paved surface has one painted, matching real-world practice)
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
