-- Links the tenants table (0022_tenant_schema.sql) to the pre-existing
-- BetterAuth organization table (Phase 0, commit 34ca825) - the two were
-- built independently tonight and share no relationship beyond both
-- rows happening to have slug='shobdon' by coincidence, not by any
-- enforced constraint. Flagged as a real gap before building Stage 3
-- (subdomain routing): resolving a subdomain needs to reach BOTH the
-- tenants row (weather_observations/latest_conditions/operational_events)
-- AND the organization row (camera_slots/carousel_slots/club_theme/
-- runway_groups/ops_panel_state/media_library - everything the actual
-- dashboard renders), and a slug-string match isn't a real join: nothing
-- stops organization.slug and tenants.slug diverging independently (e.g.
-- a future org-rename UI touching one and not the other).
--
-- Additive only - does not alter organization or any other existing
-- table. organization_id is nullable (not backfilled for hypothetical
-- future tenants, only for rows that actually have a matching org) so
-- this never blocks inserting a future tenants row ahead of its
-- organization existing, or vice versa.
--
-- UNIQUE via a partial-free index rather than an inline UNIQUE column
-- constraint: SQLite's ALTER TABLE ADD COLUMN cannot add inline UNIQUE,
-- and a CREATE UNIQUE INDEX is exactly equivalent here - it enforces
-- at most one tenants row per organization_id while still allowing
-- multiple NULLs (SQLite indexes treat each NULL as distinct, so
-- future not-yet-linked tenants rows are unaffected).
--
-- Verified against live production D1 immediately before drafting this:
-- tenants has exactly 1 row (id=1, slug='shobdon'), organization has
-- exactly 1 row (id='org_shobdon', slug='shobdon') - the backfill below
-- targets that confirmed pair, not an assumption.

ALTER TABLE tenants ADD COLUMN organization_id TEXT REFERENCES organization(id);

UPDATE tenants SET organization_id = 'org_shobdon' WHERE slug = 'shobdon';

CREATE UNIQUE INDEX idx_tenants_organization_id ON tenants(organization_id);
