-- Byte-verified buffering gate round. Per-tenant opt-in for the new
-- whole-page "BUFFERING MEDIA" black-screen gate (DashboardPage.tsx/
-- TenantDisplayPage.tsx) - separate from the existing, always-on,
-- MediaPanel-box-scoped buffering gate every tenant already has, which
-- is unaffected by this flag either way. Deliberately NOT keyed off
-- tenant_type: a future airfield tenant running several minutes of ad
-- content needs exactly the same option venue_cafe tenants do, per
-- explicit instruction not to tie this to tenant_type.
--
-- Defaults to 0 (off) for every existing and future tenant, preserving
-- every tenant's current behaviour (weather/compass/runway display
-- immediately, only the media panel itself gates) with zero migration-
-- time behaviour change - the explicit UPDATE below is what turns it on
-- for Meg's café specifically, the one tenant confirmed to need it now.
ALTER TABLE tenants ADD COLUMN full_buffer_gate_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE tenants SET full_buffer_gate_enabled = 1 WHERE slug = 'megs-cafe-media';
