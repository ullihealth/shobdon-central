-- Multi-tenant platform schema ("Airfield Central") - additive only, does
-- not alter or drop any existing table (organization / member / user /
-- session / account / verification / invitation / camera_slots /
-- carousel_slots / club_theme / media_folders / media_library /
-- ops_panel_state / runway_groups all untouched).
--
-- Target: D1 database "shobdon-central" (uuid 31656f0d-3bf3-4c0f-96bb-
-- 39bf90c9e179), bound as DB in wrangler.toml - confirmed twice, via the
-- Cloudflare account MCP tools and independently via raw `wrangler d1
-- list` / `wrangler kv namespace list` CLI output, cross-referenced
-- against every binding in both wrangler.toml files. Not
-- shobdon-central-weather-cache or shobdon-central-captures - both of
-- those are KV namespaces, not D1 databases, despite their names.
--
-- PRE-FLIGHT RESULT: GENERATED ALWAYS AS ... VIRTUAL using julianday('now')
-- was tested directly against this D1 instance and rejected outright -
-- "non-deterministic use of julianday() in a generated column:
-- SQLITE_ERROR" on INSERT (CREATE TABLE itself succeeds; D1 defers the
-- check to first write). This is not a version quirk to work around -
-- SQLite generated columns must be deterministic by design, and "is this
-- stale relative to right now" is inherently not. latest_conditions.is_stale
-- below is therefore a plain stored column, computed and written by
-- application code at read/write time (compare last_updated_at against
-- expected_interval_min against the current time), not the database.

CREATE TABLE tenants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT NOT NULL UNIQUE,        -- 'shobdon'
    name            TEXT NOT NULL,                -- 'Shobdon Airfield'
    icao_code       TEXT,
    lat             REAL,
    lon             REAL,
    subdomain       TEXT NOT NULL UNIQUE,         -- 'shobdon.airfieldcentral.com'
    weather_public  INTEGER NOT NULL DEFAULT 0,   -- independent toggle
    ops_public      INTEGER NOT NULL DEFAULT 0,   -- independent toggle
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Structured weather observations (continuous telemetry, tenant-scoped)
CREATE TABLE weather_observations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    observed_at     TEXT NOT NULL,
    captured_at     TEXT NOT NULL DEFAULT (datetime('now')),
    wind_speed_kt   REAL,
    wind_dir_deg    REAL,
    wind_gust_kt    REAL,
    qnh_hpa         REAL,
    temp_c          REAL,
    dewpoint_c      REAL,
    visibility_m    REAL,
    raw_snapshot_id TEXT
);
CREATE INDEX idx_weather_tenant_time ON weather_observations(tenant_id, observed_at DESC);

-- Latest observation cache, one row per tenant, with a staleness flag.
-- is_stale is a plain stored column (see pre-flight result above) -
-- application code is responsible for setting it whenever this row is
-- written/read, by comparing last_updated_at + expected_interval_min
-- against the current time. Defaults to 0 (not stale) for a freshly
-- written row, matching the same boolean-as-integer convention already
-- used by weather_public/ops_public/active above.
CREATE TABLE latest_conditions (
    tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id),
    observation_id  INTEGER REFERENCES weather_observations(id),
    last_updated_at TEXT NOT NULL,
    expected_interval_min INTEGER NOT NULL DEFAULT 10,
    is_stale        INTEGER NOT NULL DEFAULT 0
);

-- Operational events / alerts (event-based, own lifecycle, distinct from weather telemetry)
CREATE TABLE operational_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    category        TEXT NOT NULL,                -- 'runway' | 'circuit' | 'fuel' | 'radio' | 'ppr' | 'other'
    severity        TEXT NOT NULL DEFAULT 'info',  -- 'info' | 'caution' | 'closed'
    message         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',-- 'active' | 'resolved' | 'expired'
    starts_at       TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT,
    created_by      TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ops_tenant_status ON operational_events(tenant_id, status);

-- Seed: Shobdon's tenant row. Both public flags default 0 and are set
-- explicitly here anyway for clarity - nothing becomes publicly visible
-- as a side effect of this migration.
INSERT INTO tenants (slug, name, subdomain, weather_public, ops_public)
VALUES ('shobdon', 'Shobdon Airfield', 'shobdon.airfieldcentral.com', 0, 0);
