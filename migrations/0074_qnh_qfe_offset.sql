-- Consistent QNH/QFE rounding round. Nullable, per-tenant, platform-admin-
-- editable (PlatformTenantsPage.tsx's QnhQfeOffsetEditor) - NULL (every
-- tenant's default) means "no known fixed offset, round QNH/QFE
-- independently" (unchanged behaviour). A non-null value means "this
-- tenant's QNH and QFE are known to always differ by exactly this many
-- hPa in reality" - the display layer then derives QFE from QNH's own
-- rounding instead of rounding QFE independently, so the two displayed
-- values can never drift apart by 1 hPa purely from two numbers near a
-- .5 boundary rounding in opposite directions.
--
-- Read from the EFFECTIVE tenant (tenants.parent_tenant_id, migration
-- 0059) by publicConfig.ts, same as runway_groups/gas_prices - this is a
-- physical fact about Shobdon's own station (its QFE datum vs QNH sea-
-- level datum), not a per-tenant preference, so a tenant linked to
-- Shobdon inherits this automatically without needing its own value set.
--
-- Backfilled to 11 for Shobdon only - every other tenant (including
-- Shobdon's own linked sub-tenants, which inherit via the resolver
-- above rather than needing this set on their own row) stays NULL.
ALTER TABLE tenants ADD COLUMN qnh_qfe_offset_hpa INTEGER;

UPDATE tenants SET qnh_qfe_offset_hpa = 11 WHERE slug = 'shobdon';
