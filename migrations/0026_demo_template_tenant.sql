-- Private "template" tenant for populating realistic sample data and
-- taking marketing screenshots - completely separate from Shobdon's
-- real tenant/organization, accessible only to Jeff's existing account
-- (usr_jeff, confirmed live in production before writing this).
--
-- Additive only. Does not alter, touch, or reference Shobdon's org_shobdon
-- organization or tenant row (id=1) in any way.

-- New column, not a reuse of weather_public/ops_public - this tenant must
-- stay excluded from the public cross-tenant listing (functions/api/
-- public/tenants.ts) permanently, even if weather_public/ops_public ever
-- get flipped on by mistake (e.g. while populating sample data for
-- screenshots). is_internal is a separate, deliberate flag that only
-- this migration (or a future explicit decision) ever sets - flipping
-- weather_public/ops_public alone can never expose this tenant.
ALTER TABLE tenants ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;

INSERT INTO tenants (slug, name, subdomain, icao_code, lat, lon, weather_public, ops_public, active, is_internal)
VALUES ('demo', 'Template Airfield', 'demo.airfieldcentral.com', NULL, NULL, NULL, 0, 0, 1, 1);

-- BetterAuth organization plugin's own tables - same shape as
-- org_shobdon (0002_organization_plugin.sql), just a second, unrelated
-- row. member links Jeff's REAL existing account (usr_jeff) as the sole
-- owner - no invitation flow, no signup path, no second account created.
-- createdAt is deliberately later than mem_jeff_shobdon's
-- (2026-07-10T15:45:00.000Z) so resolveTenantMembership's "no ?org=
-- given -> first membership by createdAt" default still resolves to
-- Shobdon, not Demo - adding this second membership doesn't change
-- Jeff's existing /config etc. behaviour when visited without ?org=.
INSERT INTO organization (id, name, slug, createdAt)
VALUES ('org_demo', 'Template Airfield', 'demo', datetime('now'));

INSERT INTO member (id, organizationId, userId, role, createdAt)
VALUES ('mem_jeff_demo', 'org_demo', 'usr_jeff', 'owner', datetime('now'));

UPDATE tenants SET organization_id = 'org_demo' WHERE slug = 'demo';

-- Generic neutral slate theme - deliberately NOT Shobdon's blue
-- (#0a0de1 etc.) so screenshots read as template/placeholder branding,
-- not "this is Shobdon's".
INSERT INTO club_theme (organizationId, tokensJson, updatedAt)
VALUES (
  'org_demo',
  '{"--color-page-from":"#0f172a","--color-page-via":"#1e293b","--color-page-to":"#0f172a","--color-header-from":"rgba(30, 41, 59, 0.6)","--color-header-via":"rgba(51, 65, 85, 0.5)","--color-header-to":"rgba(30, 41, 59, 0.5)","--color-panel-bg":"rgba(30, 41, 59, 0.85)","--color-card-bg":"rgba(51, 65, 85, 0.9)","--color-border":"#475569","--color-text-primary":"#f1f5f9","--color-text-muted-300":"#e2e8f0","--color-text-muted-400":"#cbd5e1","--color-text-muted-500":"#94a3b8","--color-accent-sky-400":"#38bdf8","--color-accent-sky-500":"#0ea5e9","--color-status-good-arrow":"#10b981","--color-status-warn-arrow":"#f59e0b","--color-status-bad-arrow":"#ef4444","--color-status-good-text":"#22c55e","--color-status-warn-text":"#f59e0b","--color-status-bad-text":"#ef4444","--color-compass-fill":"rgba(30, 41, 59, 0.95)","--color-compass-ring":"rgba(56, 189, 248, 0.45)","--color-compass-cardinal":"rgba(56, 189, 248, 0.3)","--color-compass-markers":"#7dd3fc","--color-compass-disc-bg":"#0f172a"}',
  datetime('now')
);

INSERT INTO runway_groups (id, organizationId, label, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder, updatedAt)
VALUES (
  'demo-09-27',
  'org_demo',
  '09/27',
  '09',
  '27',
  90,
  1,
  216,
  14,
  '[{"colour":"#4caf50","widthPx":22,"hasThresholdMarkings":false,"showIdentifierLabel":true},{"colour":"#a8b4c4","widthPx":22,"hasThresholdMarkings":false,"showIdentifierLabel":true}]',
  0,
  datetime('now')
);

-- Plausible labels, empty urls - matches the established "empty string
-- means unset" convention (same as Shobdon's original slots 2-3 seed).
-- No real webcam feed exists for a fake airfield, so these render as
-- genuinely absent rather than a broken/fake stream - honest, not
-- "populated" in the sense of a working live feed.
INSERT INTO camera_slots (organizationId, slotNumber, label, url, updatedAt) VALUES
  ('org_demo', 1, 'Runway Camera', '', datetime('now')),
  ('org_demo', 2, 'Apron Camera', '', datetime('now')),
  ('org_demo', 3, 'Clubhouse Camera', '', datetime('now'));

INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, updatedAt)
VALUES (
  'org_demo',
  '09',
  'left',
  'PPR required - contact ops before arrival',
  '[{"text":"Fuel available 0900-1700 local","size":"md","enabled":true},{"text":"Grass runway - check NOTAMs for condition","size":"md","enabled":true}]',
  datetime('now')
);

-- 12 default carousel slots (same shape as any tenant's own defaults),
-- all disabled/unassigned at the DB level - real image content needs a
-- genuine upload through the real /media-manager flow (an R2 object,
-- not just a DB row a carousel slot can reference), done as a separate
-- follow-up step, not raw SQL.
INSERT INTO carousel_slots (organizationId, slotNumber, enabled, mediaType, durationSeconds, updatedAt) VALUES
  ('org_demo', 1, 0, 'image', 10, datetime('now')),
  ('org_demo', 2, 0, 'image', 10, datetime('now')),
  ('org_demo', 3, 0, 'image', 10, datetime('now')),
  ('org_demo', 4, 0, 'image', 10, datetime('now')),
  ('org_demo', 5, 0, 'image', 10, datetime('now')),
  ('org_demo', 6, 0, 'image', 10, datetime('now')),
  ('org_demo', 7, 0, 'image', 10, datetime('now')),
  ('org_demo', 8, 0, 'image', 10, datetime('now')),
  ('org_demo', 9, 0, 'image', 10, datetime('now')),
  ('org_demo', 10, 0, 'image', 10, datetime('now')),
  ('org_demo', 11, 0, 'image', 10, datetime('now')),
  ('org_demo', 12, 0, 'image', 10, datetime('now'));

-- Weather sample data - a plausible, static-but-fresh-looking reading.
-- last_updated_at is set to migration-run time; if this is applied well
-- before screenshots are actually taken, re-run a fresh UPDATE against
-- weather_observations/latest_conditions rather than trusting this
-- migration's own timestamp to still look "live".
INSERT INTO weather_observations (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m)
SELECT id, datetime('now'), 8, 250, 12, 1017, 18, 11, 20000
FROM tenants WHERE slug = 'demo';

INSERT INTO latest_conditions (tenant_id, observation_id, last_updated_at, expected_interval_min, is_stale)
SELECT t.id, wo.id, datetime('now'), 10, 0
FROM tenants t
JOIN weather_observations wo ON wo.tenant_id = t.id
WHERE t.slug = 'demo'
ORDER BY wo.id DESC LIMIT 1;

-- Two operational_events across different categories, per the request.
INSERT INTO operational_events (tenant_id, category, severity, message, status)
SELECT id, 'runway', 'info', 'Runway 09/27 open, grass surface in good condition', 'active'
FROM tenants WHERE slug = 'demo';

INSERT INTO operational_events (tenant_id, category, severity, message, status)
SELECT id, 'ppr', 'caution', 'PPR required for all visiting aircraft - call ahead', 'active'
FROM tenants WHERE slug = 'demo';
