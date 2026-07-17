-- Generic, vendor-agnostic weather ingestion. Additive only - does not
-- touch the existing ATC PC2 -> KV capture-ingest Worker pipeline
-- (worker/src/index.ts), which keeps working exactly as it does today.

-- source_type distinguishes how a weather_observations row arrived.
-- Existing rows (0023's Shobdon backfill, 0026's Demo seed) predate this
-- column and aren't really any of the real source types the ingestion
-- endpoint below will start writing, so they default to 'unknown'
-- rather than a misleadingly specific value.
ALTER TABLE weather_observations ADD COLUMN source_type TEXT NOT NULL DEFAULT 'unknown';

-- Per-tenant, revocable API keys for the generic weather ingestion
-- endpoint (functions/api/ingest/weather.ts). Only key_hash is ever
-- stored - the raw key is shown once at creation time
-- (functions/api/tenant/api-keys.ts's POST response) and never
-- retrievable again. No settings-page UI yet - same "owner-gated route,
-- curl/devtools with your own session cookie" posture public-visibility.ts
-- had before it got a settings-page consumer.
CREATE TABLE tenant_api_keys (
    id              TEXT PRIMARY KEY,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    key_hash        TEXT NOT NULL UNIQUE,
    key_prefix      TEXT NOT NULL,
    label           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at      TEXT,
    last_used_at    TEXT
);
CREATE INDEX idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);

-- Explicit, developer-controlled cross-tenant READ consent - "target_tenant's
-- dashboard displays source_tenant's weather instead of its own", e.g.
-- the gliding club (target) displaying Shobdon's (source) station data
-- since they're co-located and Shobdon's real station beats generic
-- regional data for both. Mirrors tenants.weather_public's own "explicit,
-- deliberately narrow, developer/owner-controlled flag" spirit rather
-- than a self-service sharing model a tenant could grant itself - this
-- table is only ever written directly against D1 (see queries below),
-- same posture as changing a tenant's storage_quota_bytes.
--
-- UNIQUE(target_tenant_id): a tenant reads from at most one source at a
-- time, keeping resolution unambiguous with no priority/ordering
-- concept needed. Nothing prevents the SAME source_tenant_id appearing
-- in multiple rows though - that's exactly what lets one source feed
-- several targets (Shobdon's data shared to both the gliding club and
-- another business at the same airfield, for example).
--
-- To grant (target reads source's data):
--   INSERT INTO tenant_weather_shares (id, source_tenant_id, target_tenant_id)
--   SELECT 'share_' || lower(hex(randomblob(8))), s.id, t.id
--   FROM tenants s, tenants t WHERE s.slug = '<source-slug>' AND t.slug = '<target-slug>';
-- To revoke:
--   DELETE FROM tenant_weather_shares WHERE target_tenant_id = (SELECT id FROM tenants WHERE slug = '<target-slug>');
CREATE TABLE tenant_weather_shares (
    id                  TEXT PRIMARY KEY,
    source_tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
    target_tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(target_tenant_id)
);
