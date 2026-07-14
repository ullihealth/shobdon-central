-- Configurable second "state" for Weather Summary (LeftInfoPanel.tsx):
-- a Cloud/Visibility Chart it can rotate into, alongside today's static
-- 5 cards, using the same staged/"Update Dashboard" flow as the Ops
-- Panel/NOTAMS fields above. DEFAULT 0 (off) is a genuine zero-visible-
-- change value - unlike 0011's NOTAMS interval (which shipped already
-- rotating), this feature stays fully inert until an admin explicitly
-- turns it on from /atc-control.
ALTER TABLE ops_panel_state ADD COLUMN weatherSummaryChartEnabled INTEGER NOT NULL DEFAULT 0;

-- Independent per-state durations (State A = existing cards, State B =
-- the chart) rather than one shared interval - the media carousel's
-- recursive-setTimeout pattern this reuses is what makes asymmetric
-- durations possible; a single symmetric interval (NOTAMS-style)
-- couldn't express "8s then 4s". Defaults match the concrete example
-- given when this feature was scoped; irrelevant while the toggle above
-- stays off, but sensible starting points once enabled.
ALTER TABLE ops_panel_state ADD COLUMN weatherSummaryStateADurationSeconds INTEGER NOT NULL DEFAULT 8;
ALTER TABLE ops_panel_state ADD COLUMN weatherSummaryStateBDurationSeconds INTEGER NOT NULL DEFAULT 5;
