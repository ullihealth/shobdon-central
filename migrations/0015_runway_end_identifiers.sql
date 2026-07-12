-- Replaces the single slash-separated `label` field (e.g. "08/26") with
-- two explicit, physically-bound columns: endAIdentifier (the end at
-- compass bearing = headingDegrees) and endBIdentifier (the reciprocal
-- end, bearing = headingDegrees + 180). This is the root-cause fix for
-- the label field's fragility - "which half of the string is which
-- physical end" was an entirely implicit convention (first half = the
-- heading-bearing end), completely invisible in the /runways UI, with
-- no way for an admin to tell which box to edit for which end. The
-- rendering itself was verified NOT to be reversed (direct testing:
-- swapping label order does correctly swap which end displays which
-- digits, at the code level) - but a one-field, undocumented-position
-- convention is exactly the kind of thing that produces confusion and
-- regressions, hence the redesign to two explicitly end-bound fields.
--
-- Split direction verified against CompassPanel.tsx's actual, tested
-- behaviour before writing this: splitRunwayLabel(label) returns
-- [first, second] = [labelTop, labelBottom], and labelTop is always
-- rendered at the physical position corresponding to bearing =
-- headingDegrees (i.e. the "heading end", now endAIdentifier).
-- Confirmed directly against real production data (id=shobdon-08-26,
-- label="26/08", headingDegrees=83): "26" renders at the ~083° end
-- today, matching production's real live screenshot from the prior
-- session. This migration reproduces that exact mapping - endA gets
-- the first half, endB the second - so it is NOT a blind re-split of
-- an ambiguous convention; it's copying a convention already directly
-- verified correct, into two columns instead of one string.
ALTER TABLE runway_groups ADD COLUMN endAIdentifier TEXT;
ALTER TABLE runway_groups ADD COLUMN endBIdentifier TEXT;

UPDATE runway_groups
SET
  endAIdentifier = CASE WHEN INSTR(label, '/') > 0 THEN TRIM(SUBSTR(label, 1, INSTR(label, '/') - 1)) ELSE TRIM(label) END,
  endBIdentifier = CASE WHEN INSTR(label, '/') > 0 THEN TRIM(SUBSTR(label, INSTR(label, '/') + 1)) ELSE '' END
WHERE endAIdentifier IS NULL;
