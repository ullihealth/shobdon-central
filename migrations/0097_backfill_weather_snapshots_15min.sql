-- One-time backfill: populate weather_snapshots_15min from every
-- EXISTING weather_observations row (run once, after migration 0096
-- creates the table and after the stray source_type='unknown' rows
-- have been removed - see the retention round's own investigation
-- report for why those 22 rows existed and were safe to remove).
--
-- Bucket = observed_at rounded down to the nearest :00/:15/:30/:45,
-- same computation the capture worker's own cron logic uses going
-- forward (see worker/src/index.ts's runSnapshotAndTrimJob) - this
-- migration and that ongoing job must stay in agreement about what a
-- "bucket" is, or the two would silently produce different buckets for
-- data straddling this one-time cutover.
--
-- Representative row per bucket: the LATEST reading within that
-- 15-minute window (closest to the bucket's own end boundary), chosen
-- via ROW_NUMBER() partitioned by tenant_id+bucket ordered by
-- observed_at DESC, rn = 1. Not the first/earliest reading - a
-- "snapshot as of this point in time" reads more naturally as "the
-- most recent known state when this window closed" than "whatever the
-- first reading happened to be right as it opened".
--
-- INSERT OR IGNORE, not a plain INSERT - relies on migration 0096's own
-- UNIQUE(tenant_id, observed_at) constraint to make this migration safe
-- to re-run without creating duplicate bucket rows (e.g. if this file
-- were ever re-applied against a database that already has some
-- snapshot rows, from a partial prior run or from the cron having
-- already started for a bucket this backfill also covers).
INSERT OR IGNORE INTO weather_snapshots_15min
    (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, runway, runway_hand, source_type)
SELECT
    tenant_id,
    bucket_at,
    wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, runway, runway_hand, source_type
FROM (
    SELECT
        tenant_id, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, qfe_hpa, temp_c, dewpoint_c, visibility_m, runway, runway_hand, source_type,
        strftime('%Y-%m-%dT%H:', observed_at) || printf('%02d', (CAST(strftime('%M', observed_at) AS INTEGER) / 15) * 15) || ':00.000Z' AS bucket_at,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, strftime('%Y-%m-%dT%H:', observed_at) || printf('%02d', (CAST(strftime('%M', observed_at) AS INTEGER) / 15) * 15)
            ORDER BY observed_at DESC
        ) AS rn
    FROM weather_observations
) ranked
WHERE rn = 1;
