-- safetyNoticesJson's shape changes from string[] to {text, size}[] -
-- same column, no ALTER TABLE needed, just a data transformation.
-- Existing entries default to size 'md' (== text-lg, today's existing
-- fixed NOTAMS-panel size), so already-migrated live content is
-- pixel-identical in appearance after this runs. The WHERE guard makes
-- this safe against empty arrays and idempotent against any row
-- already in the new object shape (json_type(...,'$[0]') is 'text' for
-- a raw string element, 'object' for {text,size} - only rows still in
-- the old shape get converted).
UPDATE ops_panel_state
SET safetyNoticesJson = (
  SELECT json_group_array(json_object('text', value, 'size', 'md'))
  FROM json_each(safetyNoticesJson)
)
WHERE json_valid(safetyNoticesJson)
  AND (json_array_length(safetyNoticesJson) = 0 OR json_type(safetyNoticesJson, '$[0]') = 'text');
