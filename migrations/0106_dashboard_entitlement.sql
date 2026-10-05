-- Reception Dashboard entitlement (Airfield Pack round, Stripe groundwork
-- Phase A). Mirrors migration 0071's own mobile_enabled pattern exactly,
-- for the same reasons: DEFAULT 0 on the column itself so any tenant
-- created AFTER this migration (onboard.ts's INSERT doesn't list this
-- column, same as it already doesn't list mobile_enabled) starts locked
-- out until the Pack is actually purchased - not a guess, a deliberate
-- mirror of the one product-gating precedent this app already has. The
-- separate UPDATE below then backfills every tenant that already exists
-- at migration time to 1, so nothing changes for anyone today (Tiger
-- included, pre-payment) - a true zero-behavior-change rollout, same
-- "testing-phase only right now" posture 0071's own comment describes.
--
-- Recommendation for onboard.ts/cloneTenant.ts (NOT implemented this
-- round - see the investigation report): no code change is needed there
-- for the same reason none was needed for mobile_enabled - neither
-- file's INSERT lists that column either, so both already rely on the
-- bare column DEFAULT for new tenants. Mirroring that exactly (rather
-- than adding an explicit dashboard_enabled: 0 to the INSERT, which
-- would be redundant with the DEFAULT and risks the two drifting if one
-- is ever edited without the other) keeps this consistent with the
-- established pattern and touches one fewer file.
ALTER TABLE tenants ADD COLUMN dashboard_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE tenants SET dashboard_enabled = 1;
