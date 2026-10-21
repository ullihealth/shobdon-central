export interface RunwayStrip {
  colour: string
  widthPx: number // this strip's own width, independent of any other strip in the group (e.g. a narrower grass strip beside a wider tarmac one)
  hasThresholdMarkings: boolean // checkerboard block at each end of this specific strip - independent per strip (e.g. tarmac on, grass off)
  showIdentifierLabel: boolean // whether this strip's own identifier numbers (e.g. "08"/"26") render at both its ends - independent per strip
  // Optional per-strip length as a whole-number percentage of the runway's own length (10-100). Missing = 100,
  // i.e. the strip runs the full runway length exactly as every strip did before this field existed. A shorter
  // strip is drawn centred on the runway's midpoint, with its markings/labels/centreline at ITS own ends.
  lengthPct?: number
  showCenterline: boolean // dashed centreline drawn along this specific strip's own axis - independent per strip (e.g. only the paved surface has one painted, matching real-world practice)
}

export interface RunwayGroup {
  id: string
  // Replaces the old single slash-separated `label` string (e.g.
  // "08/26") - each identifier is now explicitly bound to a physical
  // end, not an implicit string position. endAIdentifier is the end at
  // compass bearing = headingDegrees; endBIdentifier is the reciprocal
  // end (headingDegrees + 180). Admin-typed text, no slash-math or
  // auto-reciprocal.
  endAIdentifier: string
  endBIdentifier: string
  headingDegrees: number // precise magnetic heading for endAIdentifier's end, independently editable
  // Stored as before (runway_groups.twin 0/1 + stripsJson) - a third strip needed no schema change.
  // 1 strip = !twin; 2 strips = twin; 3 strips = twin with a third entry (twin stays true so older
  // cached dashboards still show the first two). See utils/runwayStrips.ts's runwayStripCount.
  twin: boolean
  strips: RunwayStrip[] // length 1-3
  stripLengthPx: number // full strip length (along the runway's own axis), shared by every strip in the group - CompassPanel.tsx's internal 0-400 SVG coordinate space
  identifierFontSizePx: number // font size for both identifier numbers, shared by every strip in the group that has its label shown
}
