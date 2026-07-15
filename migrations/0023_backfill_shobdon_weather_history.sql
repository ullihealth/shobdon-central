-- Backfill weather_observations / latest_conditions for Shobdon from the
-- shobdon-central-captures KV namespace ("history" and "latest" keys).
--
-- IMPORTANT - read before applying: this is a SNAPSHOT of whatever was
-- sitting in the KV rolling cache at generation time (2026-07-15T14:57Z),
-- not a full history restore. The capture worker's MAX_HISTORY = 20 means
-- it never retained more than the 20 most recent captures in the first
-- place (~60-second interval => roughly the last 20 minutes of readings)
-- - there is no deeper archive anywhere to recover beyond what's inserted
-- below. Exactly 20 of 20 available history entries were used; none were
-- skipped (all 20 were the new, structured-capture shape - no old-style
-- browser-report entries were present in this namespace at generation
-- time).
--
-- observed_at fallback: every one of these 20 entries has a null
-- parsed.observed_at_utc field. This traces to a real bug in the capture
-- worker's parseObservedAt() (worker/src/index.ts) - its regex is
-- anchored with ^ against the raw extracted Time field text, but
-- HTMLRewriter actually hands back that field with leading whitespace
-- ("\r\n    14:53:48 UTC    "), so the anchored match never succeeds.
-- Confirmed via a live KV read, not assumed - every entry in the current
-- 20-row history shows this. observed_at below uses each entry's own
-- receivedAt (the worker's server-side capture timestamp) instead, which
-- is a close proxy given the pipeline captures roughly every 60 seconds
-- and POSTs immediately. Fixing parseObservedAt itself is a Worker change
-- - out of scope for this D1-only migration, but worth doing separately
-- since every FUTURE row a dual-writing worker inserts would hit the same
-- fallback until it's fixed.

INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:57:43.856Z', '2026-07-15T14:57:43.856Z', 12, 50, NULL, 1024, 25.4, 16, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:56:43.705Z', '2026-07-15T14:56:43.705Z', 13, 70, NULL, 1024, 25.5, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:55:43.578Z', '2026-07-15T14:55:43.578Z', 13, 70, NULL, 1024, 25.5, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:54:43.428Z', '2026-07-15T14:54:43.428Z', 10, 50, NULL, 1024, 25.4, 15.7, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:53:43.291Z', '2026-07-15T14:53:43.291Z', 10, 70, NULL, 1024.1, 25.5, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:52:43.142Z', '2026-07-15T14:52:43.142Z', 12, 60, NULL, 1024.2, 25.5, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:51:43.002Z', '2026-07-15T14:51:43.002Z', 10, 100, NULL, 1024, 25.5, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:50:42.850Z', '2026-07-15T14:50:42.850Z', 10, 90, NULL, 1024, 25.4, 16, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:49:42.681Z', '2026-07-15T14:49:42.681Z', 9, 70, NULL, 1024, 25.4, 16, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:48:42.448Z', '2026-07-15T14:48:42.448Z', 8, 40, NULL, 1024.1, 25.5, 15.8, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:47:42.109Z', '2026-07-15T14:47:42.109Z', 10, 60, NULL, 1024.1, 25.7, 16.2, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:46:41.946Z', '2026-07-15T14:46:41.946Z', 6, 70, NULL, 1024, 25.4, 16.6, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:45:41.768Z', '2026-07-15T14:45:41.768Z', 6, 70, NULL, 1024, 25.4, 16.6, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:44:41.606Z', '2026-07-15T14:44:41.606Z', 9, 100, NULL, 1024.1, 25.3, 16.5, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:43:41.445Z', '2026-07-15T14:43:41.445Z', 4, 110, NULL, 1024.1, 25.3, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:42:41.281Z', '2026-07-15T14:42:41.281Z', 4, 90, NULL, 1024.1, 25.2, 16.4, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:41:41.131Z', '2026-07-15T14:41:41.131Z', 4, 100, NULL, 1024.2, 25.2, 16.1, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:40:40.991Z', '2026-07-15T14:40:40.991Z', 11, 80, NULL, 1024.2, 25.2, 15.8, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:39:40.815Z', '2026-07-15T14:39:40.815Z', 10, 80, NULL, 1024.2, 25.3, 15.9, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));
INSERT INTO weather_observations (observed_at, captured_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m, tenant_id) VALUES ('2026-07-15T14:38:40.647Z', '2026-07-15T14:38:40.647Z', 13, 90, NULL, 1024.2, 25.3, 15.9, NULL, (SELECT id FROM tenants WHERE slug = 'shobdon'));

-- latest_conditions: one row per tenant, pointed at the single newest
-- observation just inserted above (2026-07-15T14:57:43.856Z). observation_id
-- resolved by matching tenant_id + observed_at rather than assuming a
-- specific autoincrement value, since this file may run after other
-- inserts have already advanced the sequence.
INSERT INTO latest_conditions (tenant_id, observation_id, last_updated_at, expected_interval_min)
SELECT
  t.id,
  (SELECT wo.id FROM weather_observations wo WHERE wo.tenant_id = t.id ORDER BY wo.observed_at DESC LIMIT 1),
  '2026-07-15T14:57:43.856Z',
  10
FROM tenants t WHERE t.slug = 'shobdon';
