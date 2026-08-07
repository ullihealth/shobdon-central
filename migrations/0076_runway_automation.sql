-- SADDS automation round. Default ON (1) per Shobdon's stated
-- preference: the automated connection is the normal/expected state,
-- manual is the exception. When on, functions/api/ingest/weather.ts
-- keeps activeRunwayEnd/circuitDirection in sync with SADDS captures on
-- every ingest; functions/api/tenant/ops-panel/index.ts's PUT rejects
-- any manual change to those two fields unless the same request also
-- turns this off (see that file's own comment for the exact 409 shape).
ALTER TABLE ops_panel_state ADD COLUMN runwayAutomationEnabled INTEGER NOT NULL DEFAULT 1;
