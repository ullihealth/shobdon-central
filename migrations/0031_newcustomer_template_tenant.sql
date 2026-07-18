-- Second private "template" tenant, separate from both Shobdon (the real
-- production tenant) and Demo (migration 0026, an existing internal
-- template used for sample data / screenshots). This one is a clean
-- clone source for future onboarding and for landing-page/marketing
-- screenshots - generic content throughout, no real airfield's data or
-- branding. Modelled directly on 0026_demo_template_tenant.sql's shape.
--
-- Additive only. Does not alter, touch, or reference Shobdon's or
-- Demo's tenant/organization rows in any way.

-- is_internal = 1: developer-only, permanently excluded from the public
-- cross-tenant directory (functions/api/public/tenants.ts), same as
-- Demo - see that route's WHERE clause (active = 1 AND is_internal = 0
-- AND ...). If this tenant should be public-facing instead, that's a
-- one-flag change (flip to 0 here, or toggle it live afterward via the
-- existing Internal checkbox on /platform/tenants) - not a rebuild.
--
-- lat/lon left NULL, matching Demo's own existing precedent exactly.
-- functions/api/public/weather-default.ts 404s on NULL lat/lon, and the
-- client (src/services/weatherConfigStore.ts) falls back to
-- DEFAULT_WEATHER_CONFIG, which already hardcodes activeProvider:
-- 'mock' - this is what actually satisfies "mock weather source" for a
-- fresh device on this tenant, not a dedicated weather-source column
-- (no such column exists on tenants; see that file for the real
-- mechanism).
--
-- No has_physical_atc / ATC-capability flag: confirmed no such column
-- or gating exists anywhere in this codebase today (ChecklistPage and
-- PC2CaptureSetup render unconditionally for every tenant). Flagging
-- this rather than building it, per instruction - /checklist and the
-- PC2 setup section will be reachable on this tenant exactly as they
-- are on every other tenant, not hidden. Worth a follow-up before
-- onboarding goes live.
INSERT INTO tenants (slug, name, subdomain, icao_code, lat, lon, weather_public, ops_public, active, is_internal)
VALUES ('newcustomer', 'Your Airfield Name', 'newcustomer.airfieldcentral.com', NULL, NULL, NULL, 0, 0, 1, 1);

-- BetterAuth organization plugin's own tables - same shape as org_demo.
-- member links Jeff's REAL existing account (usr_jeff) as sole owner -
-- no invitation flow, no signup path, no second account created.
-- createdAt deliberately later than mem_jeff_shobdon's and
-- mem_jeff_demo's so resolveTenantMembership's "no ?org= given -> first
-- membership by createdAt" default still resolves to Shobdon.
INSERT INTO organization (id, name, slug, createdAt)
VALUES ('org_newcustomer', 'Your Airfield Name', 'newcustomer', datetime('now'));

INSERT INTO member (id, organizationId, userId, role, createdAt)
VALUES ('mem_jeff_newcustomer', 'org_newcustomer', 'usr_jeff', 'owner', datetime('now'));

UPDATE tenants SET organization_id = 'org_newcustomer' WHERE slug = 'newcustomer';

-- Reuses Demo's exact neutral slate theme token set - already
-- established as "generic, not branded" (deliberately not Shobdon's
-- blue), no need to invent a second palette for a second template
-- tenant that wants the same thing Demo already achieves.
INSERT INTO club_theme (organizationId, tokensJson, updatedAt)
VALUES (
  'org_newcustomer',
  '{"--color-page-from":"#0f172a","--color-page-via":"#1e293b","--color-page-to":"#0f172a","--color-header-from":"rgba(30, 41, 59, 0.6)","--color-header-via":"rgba(51, 65, 85, 0.5)","--color-header-to":"rgba(30, 41, 59, 0.5)","--color-panel-bg":"rgba(30, 41, 59, 0.85)","--color-card-bg":"rgba(51, 65, 85, 0.9)","--color-border":"#475569","--color-text-primary":"#f1f5f9","--color-text-muted-300":"#e2e8f0","--color-text-muted-400":"#cbd5e1","--color-text-muted-500":"#94a3b8","--color-accent-sky-400":"#38bdf8","--color-accent-sky-500":"#0ea5e9","--color-status-good-arrow":"#10b981","--color-status-warn-arrow":"#f59e0b","--color-status-bad-arrow":"#ef4444","--color-status-good-text":"#22c55e","--color-status-warn-text":"#f59e0b","--color-status-bad-text":"#ef4444","--color-compass-fill":"rgba(30, 41, 59, 0.95)","--color-compass-ring":"rgba(56, 189, 248, 0.45)","--color-compass-cardinal":"rgba(56, 189, 248, 0.3)","--color-compass-markers":"#7dd3fc","--color-compass-disc-bg":"#0f172a"}',
  datetime('now')
);

INSERT INTO runway_groups (id, organizationId, label, endAIdentifier, endBIdentifier, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder, updatedAt)
VALUES (
  'newcustomer-09-27',
  'org_newcustomer',
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

-- Plausible labels, empty urls - same "honest absence" convention as
-- Demo's own seed. No real webcam feed exists for a template tenant.
INSERT INTO camera_slots (organizationId, slotNumber, label, url, updatedAt) VALUES
  ('org_newcustomer', 1, 'Runway Camera', '', datetime('now')),
  ('org_newcustomer', 2, 'Apron Camera', '', datetime('now')),
  ('org_newcustomer', 3, 'Clubhouse Camera', '', datetime('now'));

INSERT INTO ops_panel_state (organizationId, activeRunwayEnd, circuitDirection, airfieldInfoText, safetyNoticesJson, updatedAt)
VALUES (
  'org_newcustomer',
  '09',
  'left',
  'PPR required - contact ops before arrival',
  '[{"text":"Fuel available 0900-1700 local","size":"md","enabled":true},{"text":"Grass runway - check NOTAMs for condition","size":"md","enabled":true}]',
  datetime('now')
);

-- 12 default carousel slots, all disabled/unassigned at the DB level -
-- no logo, no carousel media set for this tenant (uses the generic
-- empty-state already fixed in the pre-onboarding branding audit).
INSERT INTO carousel_slots (organizationId, slotNumber, enabled, mediaType, durationSeconds, updatedAt) VALUES
  ('org_newcustomer', 1, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 2, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 3, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 4, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 5, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 6, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 7, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 8, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 9, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 10, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 11, 0, 'image', 10, datetime('now')),
  ('org_newcustomer', 12, 0, 'image', 10, datetime('now'));

-- Plausible, static-but-fresh-looking weather sample data for
-- screenshots - same shape as Demo's own seed. If this migration is
-- applied well before screenshots are actually taken, re-run a fresh
-- UPDATE against weather_observations/latest_conditions rather than
-- trusting this migration's own timestamp to still look "live".
INSERT INTO weather_observations (tenant_id, observed_at, wind_speed_kt, wind_dir_deg, wind_gust_kt, qnh_hpa, temp_c, dewpoint_c, visibility_m)
SELECT id, datetime('now'), 8, 250, 12, 1017, 18, 11, 20000
FROM tenants WHERE slug = 'newcustomer';

INSERT INTO latest_conditions (tenant_id, observation_id, last_updated_at, expected_interval_min, is_stale)
SELECT t.id, wo.id, datetime('now'), 10, 0
FROM tenants t
JOIN weather_observations wo ON wo.tenant_id = t.id
WHERE t.slug = 'newcustomer'
ORDER BY wo.id DESC LIMIT 1;

INSERT INTO operational_events (tenant_id, category, severity, message, status)
SELECT id, 'runway', 'info', 'Runway 09/27 open, grass surface in good condition', 'active'
FROM tenants WHERE slug = 'newcustomer';

INSERT INTO operational_events (tenant_id, category, severity, message, status)
SELECT id, 'ppr', 'caution', 'PPR required for all visiting aircraft - call ahead', 'active'
FROM tenants WHERE slug = 'newcustomer';
