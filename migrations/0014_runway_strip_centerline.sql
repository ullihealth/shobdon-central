-- stripsJson entries gain a 'showCenterline' field, same additive JSON1
-- pattern as 0012/0013 (no ALTER TABLE, just a data transformation).
--
-- Deliberately NOT a blanket default of true for every strip, even though
-- that's the simpler rule and matches the general request. Today's actual
-- rendering (CompassPanel.tsx, pre-fix) draws exactly ONE centreline per
-- group, anchored to the LAST strip in its strips array (the paved/tarmac
-- strip for Shobdon's twin group; the sole strip for any single-strip
-- group) - never the earlier strip(s). A blanket true would give the
-- grass strip a centreline it has never had, a real visible change to the
-- live dashboard. Instead: the last strip in each group's array defaults
-- to showCenterline=true (reproducing exactly what's already drawn today,
-- verified via dry-run against real Shobdon data: grass -> false,
-- tarmac -> true), every earlier strip defaults to false - true zero
-- visual change, not just a same-for-everyone default. Once the fix lands,
-- centreline rendering becomes genuinely per-strip (independent toggle at
-- each strip's own position), matching hasThresholdMarkings' existing
-- pattern - this migration only sets the STARTING value each strip needs
-- to keep displaying exactly what it displays today.
UPDATE runway_groups
SET stripsJson = (
  SELECT json_group_array(
    json_set(
      value,
      '$.showCenterline',
      CASE WHEN key = json_array_length(stripsJson) - 1 THEN json('true') ELSE json('false') END
    )
  )
  FROM json_each(stripsJson)
)
WHERE json_valid(stripsJson)
  AND (json_array_length(stripsJson) = 0 OR json_extract(stripsJson, '$[0].showCenterline') IS NULL);
