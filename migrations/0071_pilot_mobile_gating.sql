-- Tenant-level access gating for the Pilot View (/pilot, migration 0070).
-- Two new scalar columns on tenants, same posture as afiso_open/
-- afiso_frequency/has_physical_atc etc already on this table.
--
-- mobile_enabled: platform-admin-set switch. When false, PilotViewPage.tsx
-- renders a locked-state screen (tenant logo/brand colours + a teaser
-- message) instead of the full mobile dashboard - see that file. Column
-- DEFAULT is 0 (gated) so any tenant created after this migration starts
-- locked out until explicitly turned on; the backfill below is a one-time
-- exception for tenants that already existed before this feature shipped.
ALTER TABLE tenants ADD COLUMN mobile_enabled INTEGER NOT NULL DEFAULT 0;

-- mobile_free_until: placeholder only, deliberately NOT wired to any
-- gating logic yet - reserved for a future Stripe-billing "free trial
-- expires on this date" flow. Nullable, no default value, no UI to set
-- it yet (not added to the platform tenants PATCH route this round) -
-- exists purely so the column is already in place when that billing work
-- starts, rather than needing another migration then.
ALTER TABLE tenants ADD COLUMN mobile_free_until TEXT;

-- Testing-phase backfill: every tenant that already exists gets mobile
-- access turned on immediately - this is explicitly NOT a live
-- restriction yet, just getting the gate itself built and wired before
-- it's ever actually used to lock anyone out. Only runs once, against
-- whatever rows exist at migration time; it does not affect the column's
-- own DEFAULT 0 for tenants created afterward.
UPDATE tenants SET mobile_enabled = 1;
