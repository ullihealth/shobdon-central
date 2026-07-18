-- Per-tenant logo, alongside the existing tenants.name (already the
-- source of airfieldName in publicConfig.ts / tenant/config.ts).
-- Additive only. Stores the R2 object key, not a full URL - same
-- convention media_library.r2Key already uses - resolved to a public
-- URL at read time via MEDIA_PUBLIC_BASE_URL. NULL means no logo set,
-- which is the correct/default state for every existing tenant
-- (Shobdon, Demo) until someone uploads one via the new self-service
-- or platform-admin branding endpoints.
ALTER TABLE tenants ADD COLUMN logo_r2_key TEXT;
