-- Parent tenant / sub-tenant hierarchy (Jeff's own framing: "parent
-- airfield" / "sub-tenant") - one column, self-referencing FK, one
-- parent per tenant. Generalizes tenant_weather_shares (migration
-- 0029), which only ever expressed this same one-parent-per-tenant
-- relationship (enforced there via UNIQUE(target_tenant_id)) for
-- weather specifically. This round found the exact same "co-located
-- sub-tenant" relationship is also needed for Met Office forecasts,
-- NOTAMs, gas prices, runway/compass data, and active-runway/circuit
-- status - none of which tenant_weather_shares' own name/framing could
-- reasonably stretch to cover without misleading whoever reads it next.
--
-- ON DELETE SET NULL, not CASCADE - hard-deleting a parent tenant must
-- never cascade-delete every tenant linked to it; it should just leave
-- them unlinked (identical end state to manually clearing the link),
-- which is exactly what SET NULL does. D1 confirmed to enforce FK
-- actions (functions/api/platform/tenants/[id]/hard-delete.ts's own
-- comment: "D1 has PRAGMA foreign_keys = 1, verified empirically", for
-- ON DELETE CASCADE elsewhere) - re-verified for SET NULL specifically
-- as part of this round's own testing, not just assumed from that.
--
-- Every domain reads this at RESPONSE-BUILD TIME via one shared
-- resolver (functions/api/_utils/resolveParentTenant.ts), never writes
-- through it - a sub-tenant's own stored rows (runway_groups,
-- gas_prices, ops_panel_state, etc.) are NEVER modified or deleted by
-- linking/unlinking a parent; they're just shadowed by the parent's
-- data while linked, and instantly revert to their own on unlink.
ALTER TABLE tenants ADD COLUMN parent_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL;

-- Migrates the one existing REAL link (Gyroplane Train -> Shobdon,
-- previously expressed only via tenant_weather_shares) onto the new
-- column. Filtered on is_internal = 0 (not a hardcoded tenant id, which
-- would silently be wrong against any D1 copy where autoincrement ids
-- differ from production - confirmed they already do between this
-- app's local/production databases) - the only OTHER existing
-- tenant_weather_shares row (Shobdon -> the internal 'newcustomer'
-- template tenant, is_internal = 1) is deliberately excluded: that's
-- not a real co-located sub-tenant, it's the internal onboarding
-- template, out of this round's scope.
--
-- tenant_weather_shares itself is deliberately left in place, data
-- untouched - not dropped (nothing warrants a destructive drop this
-- round) but nothing reads from it anymore as of this round's code
-- changes.
UPDATE tenants
SET parent_tenant_id = (
  SELECT s.source_tenant_id FROM tenant_weather_shares s WHERE s.target_tenant_id = tenants.id
)
WHERE is_internal = 0
  AND EXISTS (SELECT 1 FROM tenant_weather_shares s WHERE s.target_tenant_id = tenants.id);
