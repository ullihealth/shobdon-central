-- Lets ATC hide the automated NOTAM feed from Safety Notices independent
-- of the manual rows (e.g. a NOTAM's wording is misleading/stale for the
-- current situation and a manual notice says it better). DEFAULT 1
-- applies to the ALTER itself too - every existing row (just Shobdon so
-- far) keeps showing auto-NOTAMs exactly as before until explicitly
-- turned off below, so this column addition alone changes nothing live.
ALTER TABLE ops_panel_state ADD COLUMN showAutoNotams INTEGER NOT NULL DEFAULT 1;

-- Deliberate, real content change for Shobdon specifically (not a
-- zero-visible-change seed like 0009's values were) - turns the auto feed
-- off and adds the AFIS-downgrade notice as the only Safety Notices entry,
-- per explicit instruction for this deployment.
UPDATE ops_panel_state
SET showAutoNotams = 0, safetyNoticesJson = '["Shobdon AFIS downgraded to AGCS"]'
WHERE organizationId = 'org_shobdon';
