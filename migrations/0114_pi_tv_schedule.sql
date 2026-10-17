-- TV wake/sleep schedule round (HDMI-CEC) - platform-admin only, per Pi
-- unit (not per-tenant). Investigated first: pi_units.tenant_name is
-- deliberately free text, not a FK (see migration 0098's own comment -
-- "some Pis are prepped... before the tenant even exists"), so a
-- schedule tied to the pi_units row itself inherits none of that
-- early-provisioning timing problem, and naturally supports a future
-- multi-box tenant with no schema change.
--
-- No per-box token column - a single shared Cloudflare secret
-- (PI_FLEET_KEY, set directly via `wrangler pages secret put`, never
-- stored in D1/code/commits) gates the box poll route instead.
--
-- All columns default to inert (enabled=0, everything else NULL) - no
-- existing pi_units row's behaviour changes until a platform admin
-- explicitly configures and enables a schedule for that specific unit.
ALTER TABLE pi_units ADD COLUMN tv_schedule_enabled INTEGER NOT NULL DEFAULT 0;

-- {"mon":{"wake":"07:00","sleep":"22:00","off":false}, ..., "sun":{...}}
-- - small, bounded, always-fully-overwritten on save, matching the
-- JSON-column posture this migration's own sibling (0098) already
-- documents as the right fit for that shape (vs. an append-only log,
-- which this is not). Same-day-only (sleep after wake) - see
-- functions/api/_utils/tvSchedule.mjs's own comment on why overnight
-- schedules are rejected, not supported.
ALTER TABLE pi_units ADD COLUMN tv_schedule_json TEXT;

-- Wake now / Sleep now - holds until the NEXT scheduled transition
-- (computed server-side at override-creation time), not a fixed delay.
-- Both NULL = no active override.
ALTER TABLE pi_units ADD COLUMN tv_schedule_override_state TEXT;
ALTER TABLE pi_units ADD COLUMN tv_schedule_override_until TEXT;

-- Written by the box's own poll check-in (functions/api/public/pi-units/
-- tv-schedule.ts) - this is the FIRST heartbeat/last-seen signal this
-- table has ever had (pi_units otherwise has none - confirmed before
-- this round, updated_at only ever reflects admin edits).
ALTER TABLE pi_units ADD COLUMN tv_schedule_last_seen_at TEXT;
ALTER TABLE pi_units ADD COLUMN tv_schedule_last_command TEXT;
ALTER TABLE pi_units ADD COLUMN tv_schedule_last_command_at TEXT;
ALTER TABLE pi_units ADD COLUMN tv_schedule_last_error TEXT;
