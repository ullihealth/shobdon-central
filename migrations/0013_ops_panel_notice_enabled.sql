-- safetyNoticesJson entries gain an 'enabled' field ({text, size} ->
-- {text, size, enabled}) - same column, no ALTER TABLE, just a data
-- transformation, same pattern as 0012's size-field migration. Existing
-- entries default to enabled=true so every currently-displayed notice
-- stays visibly displayed after this runs - zero visible change for
-- live content. Verified against real D1 (json_set + json('true'))
-- that this produces a genuine JSON boolean, not a quoted string or an
-- integer 1/0. The WHERE guard (json_extract(...,'$[0].enabled') IS
-- NULL) makes this safe against empty arrays and idempotent against any
-- row already carrying the field - only rows still missing it get
-- touched.
UPDATE ops_panel_state
SET safetyNoticesJson = (
  SELECT json_group_array(json_set(value, '$.enabled', json('true')))
  FROM json_each(safetyNoticesJson)
)
WHERE json_valid(safetyNoticesJson)
  AND (json_array_length(safetyNoticesJson) = 0 OR json_extract(safetyNoticesJson, '$[0].enabled') IS NULL);
