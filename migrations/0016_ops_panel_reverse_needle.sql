-- Developer-only safety-net override for the wind arrow's visual
-- rotation - see functions/api/tenant/developer-settings/index.ts and
-- CompassPanel.tsx. Deliberately lives on ops_panel_state (the existing
-- tenant-scoped singleton dashboard-config row, same table
-- showAutoNotams etc. already live on) rather than a bare per-request
-- flag, so it persists and is servable from the same public config
-- endpoint CompassPanel.tsx already fetches - no new table needed for
-- one boolean.
--
-- Column defaults to 0 (off) for any future tenant, but this migration
-- explicitly turns it ON for existing rows (just Shobdon today) - see
-- the investigation in this deploy's commit message for why: no code
-- regression was found (the arrow's rotation formula is unchanged since
-- the very first commit), but two legitimate, conflicting real-world
-- wind-arrow conventions exist (windsock: arrow points downwind: vs.
-- weathervane: arrow points into/upwind), and the reported live result
-- did not match what was expected against real current wind - so this
-- turns the correction on immediately without asserting a formula
-- rewrite I can't independently verify with 100% certainty.
ALTER TABLE ops_panel_state ADD COLUMN reverseCompassNeedle INTEGER NOT NULL DEFAULT 0;

UPDATE ops_panel_state SET reverseCompassNeedle = 1;
