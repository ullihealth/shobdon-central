-- Named per-tenant displays (e.g. the main kiosk vs. a clubhouse cafe
-- TV), each with its own layout template and panel visibility. Additive
-- only - does not alter any existing table. A 'main' row is seeded for
-- every existing active tenant below with a panel_config reflecting
-- exactly what's currently shown, so nothing changes visually for
-- Shobdon or Demo today; new displays only take effect when
-- deliberately created (functions/api/tenant/displays.ts).
--
-- tenant_id references tenants(id) (INTEGER PK), not organizationId -
-- consistent with weather_observations/operational_events, which also
-- key off tenants.id rather than the BetterAuth organization id that
-- most of the tenant-config tables (camera_slots, carousel_slots,
-- club_theme, etc.) use. Public reads still need to go tenants.id ->
-- tenants.organization_id -> those tables, same join every other public
-- route not fully migrated to the tenants-level id already does.
CREATE TABLE tenant_displays (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    template_id     TEXT NOT NULL DEFAULT 'classic',
    panel_config    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, slug)
);

-- panel_config here matches exactly what DashboardPage.tsx (the current,
-- untouched-by-this-migration live layout) always shows: weather,
-- compass, media carousel, and the ops/safety-notices panel, all on.
INSERT INTO tenant_displays (tenant_id, slug, name, template_id, panel_config)
SELECT id, 'main', 'Main Dashboard', 'classic', '{"weather":true,"compass":true,"media":true,"ops":true}'
FROM tenants
WHERE active = 1;
