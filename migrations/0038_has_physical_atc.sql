-- Gates PC2/ATC hardware capture setup content (ChecklistPage.tsx,
-- PC2CaptureSetup.tsx) and the "ATC Live Weather Station" option in
-- WeatherSourceSelector.tsx behind whether a tenant actually has
-- physical ATC/PC2 hardware. Task #23 - confirmed this round that no
-- such flag or gating existed anywhere: both components rendered
-- unconditionally for every tenant, and the weather source picker let
-- any tenant select "atc" regardless of whether they had a station
-- capturing data for it. Weather itself already degraded safely
-- without this flag (NULL lat/lon -> mock provider fallback, confirmed
-- separately) - this migration is specifically about not showing
-- Shobdon-specific hardware setup instructions to a tenant (e.g. a
-- gyrocopter/microlight/gliding club) that has no PC2 to set up.
--
-- DEFAULT 0: a newly onboarded tenant (cloned from 'newcustomer', see
-- functions/api/_utils/cloneTenant.ts) has no known hardware until a
-- platform admin confirms otherwise - matches this migration's own
-- explicit backfill below (newcustomer/demo both false), and the
-- clone pipeline never touches the tenants table's own columns
-- (cloneTenantTemplate only copies org-scoped child-table rows), so a
-- freshly cloned tenant inherits this default automatically with no
-- code change needed there.
ALTER TABLE tenants ADD COLUMN has_physical_atc INTEGER NOT NULL DEFAULT 0;

-- Explicit backfill for all three tenant rows that exist today
-- (confirmed directly against production - no other tenant rows exist
-- yet, the onboarding pipeline has never actually been used for a real
-- customer). Written out for all three, not just Shobdon, so the
-- reasoning for each is on record rather than leaving demo/newcustomer
-- to an implicit DEFAULT with no stated justification.
UPDATE tenants SET has_physical_atc = 1 WHERE slug = 'shobdon';
UPDATE tenants SET has_physical_atc = 0 WHERE slug = 'demo';
UPDATE tenants SET has_physical_atc = 0 WHERE slug = 'newcustomer';
