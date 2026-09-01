-- Café Reserved Owner Slots round, per-tenant reservation (investigated
-- and approved this round). Previously "reserved" meant exactly slots
-- 5/8/12, hardcoded as RESERVED_SLOT_NUMBERS in both
-- functions/api/tenant/cafe-carousel/index.ts and
-- functions/api/platform/tenants/[id]/cafe-carousel-owner-slots.ts -
-- confirmed via investigation this was enforced server-side (not just
-- the admin page's fixed 3-card UI), so no other slot number could ever
-- be reserved for any tenant. This column replaces that hardcoded list
-- as the source of truth: any of a tenant's 12 slots can now be
-- individually designated reserved, managed via the platform-admin
-- owner-slots tool.
--
-- Backfill sets it on every tenant's EXISTING 5/8/12 rows so today's
-- live reserved slots (Meg's Cafe, and the org_newcustomer template
-- every new signup clones from) keep working identically post-deploy -
-- no per-tenant manual fixup needed, and cloneTenantTemplate carries
-- this forward to every future signup automatically since it just
-- copies org_newcustomer's own rows verbatim.
ALTER TABLE cafe_carousel_slots ADD COLUMN ownerSlotReserved INTEGER NOT NULL DEFAULT 0;

UPDATE cafe_carousel_slots SET ownerSlotReserved = 1 WHERE slotNumber IN (5, 8, 12);
