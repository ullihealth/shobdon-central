-- Configurable rotation interval for the Ops Panel's State A (runway/
-- circuit/airfield info) <-> State B (NOTAMS) client-side toggle, set
-- via /atc-control. Unlike 0009/0010's seed values, DEFAULT 5 is NOT a
-- zero-visible-change value - rotation didn't exist before this
-- feature, so every tenant (Shobdon included, no separate UPDATE here)
-- starts rotating at a 5 second interval the moment this deploys. That
-- is the intended, expected behaviour of shipping this feature, not an
-- oversight to correct.
ALTER TABLE ops_panel_state ADD COLUMN notamsCarouselIntervalSeconds INTEGER NOT NULL DEFAULT 5;
