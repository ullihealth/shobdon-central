-- Tenant-configurable compass needle / runway wind widget arrow colour
-- thresholds - developer-editable only via direct D1 update on request
-- from a tenant, no self-service UI (see determineArrowColour in
-- src/utils/windCalculations.ts). Stored as positive kt magnitudes; the
-- sign/direction (e.g. tailwind being a NEGATIVE headwind component) is
-- handled in code, not in the stored value. Defaults match the values
-- that were previously hardcoded directly in windCalculations.ts.
--
-- Any direct edit to these three columns on request from a tenant should
-- be logged in docs/arrow-threshold-changes.md (old value -> new value,
-- date, requested by/why) - see that file's own header comment.
ALTER TABLE tenants ADD COLUMN arrow_tailwind_kt INTEGER NOT NULL DEFAULT 2;
ALTER TABLE tenants ADD COLUMN arrow_crosswind_kt INTEGER NOT NULL DEFAULT 5;
ALTER TABLE tenants ADD COLUMN arrow_headwind_kt INTEGER NOT NULL DEFAULT 3;
