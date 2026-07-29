-- ATC-triggered override, same table/pattern as showAutoNotams
-- (migration 0010) - a single source of truth flowing through the
-- existing shared opsPanel object (publicConfig.ts's
-- buildPublicConfigData), so every render location that already reads
-- opsPanel.activeRunwayEnd/circuitDirection picks this up automatically
-- with no separate wiring per page. DEFAULT 0 applies to the ALTER
-- itself too - every existing row keeps showing its normal runway/
-- circuit display exactly as before until an ATC user explicitly
-- toggles this on, so this column addition alone changes nothing live.
ALTER TABLE ops_panel_state ADD COLUMN runwaysClosed INTEGER NOT NULL DEFAULT 0;
