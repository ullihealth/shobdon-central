-- Weather capture retention round - the 15-minute downsampled table that
-- eventually powers a rolling 12-month chart, sitting alongside
-- weather_observations (which this same round trims to a rolling 24
-- hours - see the capture worker's own scheduled() handler comment for
-- the trim logic). One row per tenant per 15-minute bucket, forever
-- (until the 12-month trim catches up to it) - drastically fewer rows
-- than the raw table regardless of how fine the live capture interval
-- is (4/hour/tenant either way), which is the whole point of
-- downsampling rather than just keeping everything.
--
-- observed_at here is the BUCKET's own boundary timestamp (always
-- exactly :00/:15/:30/:45:00.000Z), NOT copied raw from whichever
-- source weather_observations row was chosen to represent that bucket -
-- deliberately, so the resulting series is perfectly evenly spaced and
-- trivial to query/chart later, and so "does a snapshot already exist
-- for the current bucket" is a plain equality check rather than a range
-- query. The UNIQUE constraint below both enforces "one row per tenant
-- per bucket" and is what makes the cron's own insert idempotent via
-- INSERT OR IGNORE - no separate existence check needed first.
--
-- Same relevant weather columns as weather_observations, minus the ones
-- that don't make sense for a downsampled snapshot (captured_at - a
-- per-capture ingest timestamp, meaningless once multiple raw rows have
-- been collapsed into one; raw_snapshot_id - points at a specific raw
-- capture, same reasoning; notams_json - NOTAMs aren't really a
-- "snapshot" concept, and the existing NOTAMs feature already has its
-- own current-state source, not sourced from weather_observations at
-- all).
CREATE TABLE weather_snapshots_15min (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
    observed_at     TEXT NOT NULL,
    wind_speed_kt   REAL,
    wind_dir_deg    REAL,
    wind_gust_kt    REAL,
    qnh_hpa         REAL,
    qfe_hpa         REAL,
    temp_c          REAL,
    dewpoint_c      REAL,
    visibility_m    REAL,
    runway          TEXT,
    runway_hand     TEXT,
    source_type     TEXT NOT NULL DEFAULT 'unknown',
    UNIQUE(tenant_id, observed_at)
);

-- Same access pattern as weather_observations' own idx_weather_tenant_time
-- (migration 0022) - every real query here is "this tenant's rows,
-- newest first" (the future chart, and Step 6's simple list view), so
-- the same (tenant_id, observed_at DESC) shape applies.
CREATE INDEX idx_weather_snapshots_tenant_time ON weather_snapshots_15min(tenant_id, observed_at DESC);
