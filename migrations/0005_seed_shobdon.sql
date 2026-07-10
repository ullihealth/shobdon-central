-- Seed migration: Shobdon becomes tenant #1. All config values below are
-- copied from the CURRENT known-live source of truth - NOT read from any
-- browser's localStorage (which a server-side migration can't access
-- anyway) - specifically:
--   - runway_groups: src/services/clubProfileStore.ts's DEFAULT_CLUB_PROFILE
--   - club_theme:    the Worker's live 'theme' KV value, fetched via
--                     GET https://shobdon-central-capture.jeffthompson.workers.dev/theme
--                     at migration-authoring time
--   - camera_slots:  DEFAULT_CLUB_PROFILE.webcamUrl (rtsp.me feed) as slot 1,
--                     slots 2-3 seeded empty per the agreed 3-slot design
-- This keeps the eventual dashboard cutover byte-identical to today's
-- rendering, since it reads the exact same values, just from D1 instead
-- of localStorage/global KV.
--
-- The seeded user's password is a generated random string, PBKDF2-hashed
-- with the same algorithm functions/api/auth/[[path]].ts verifies with -
-- reported out-of-band to the admin, not written here in plaintext.
-- Change it after first login.

INSERT INTO organization (id, name, slug, logo, metadata, createdAt)
VALUES ('org_shobdon', 'Shobdon Airfield', 'shobdon', NULL, NULL, '2026-07-10T15:45:00.000Z');

INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, developer)
VALUES ('usr_jeff', 'Jeff Thompson', 'jeffthompson@europe.com', 1, NULL, '2026-07-10T15:45:00.000Z', '2026-07-10T15:45:00.000Z', 1);

-- providerId/accountId convention confirmed from BetterAuth's own sign-up
-- handler source (node_modules/better-auth/dist/api/routes/sign-up.mjs):
-- providerId is always 'credential' for email+password, accountId equals
-- the user's own id (not the email).
INSERT INTO account (id, userId, accountId, providerId, password, createdAt, updatedAt)
VALUES ('acc_jeff_credential', 'usr_jeff', 'usr_jeff', 'credential',
  'pbkdf2$10000$l1Dzo1P+TyxoAJ4pYL8AGg==$6h/uDppKx8wGk3Dzeruxfye/rcvqCJ3X9tq98Z/aknQ=',
  '2026-07-10T15:45:00.000Z', '2026-07-10T15:45:00.000Z');

INSERT INTO member (id, organizationId, userId, role, createdAt)
VALUES ('mem_jeff_shobdon', 'org_shobdon', 'usr_jeff', 'owner', '2026-07-10T15:45:00.000Z');

INSERT INTO runway_groups (id, organizationId, label, headingDegrees, twin, stripLengthPx, identifierFontSizePx, stripsJson, sortOrder, updatedAt)
VALUES (
  'shobdon-08-26',
  'org_shobdon',
  '08/26',
  83,
  1,
  216,
  14,
  '[{"colour":"#4caf50","widthPx":22,"hasThresholdMarkings":false,"showIdentifierLabel":true},{"colour":"#a8b4c4","widthPx":22,"hasThresholdMarkings":false,"showIdentifierLabel":true}]',
  0,
  '2026-07-10T15:45:00.000Z'
);

INSERT INTO club_theme (organizationId, tokensJson, updatedAt)
VALUES (
  'org_shobdon',
  '{"--color-page-from":"#0a0de1","--color-page-via":"#131ad7","--color-page-to":"#0a0de1","--color-header-from":"rgba(52, 50, 110, 0.6)","--color-header-via":"rgba(10, 13, 225, 0.5)","--color-header-to":"rgba(50, 50, 110, 0.5)","--color-panel-bg":"rgba(27, 27, 187, 0.85)","--color-card-bg":"rgba(10, 13, 225, 0.9)","--color-border":"#3b82f6","--color-text-primary":"#ffffff","--color-text-muted-300":"#dbeafe","--color-text-muted-400":"#93c5fd","--color-text-muted-500":"#60a5fa","--color-accent-sky-400":"#22d3ee","--color-accent-sky-500":"#06b6d4","--color-status-good-arrow":"#10b981","--color-status-warn-arrow":"#f59e0b","--color-status-bad-arrow":"#ef4444","--color-status-good-text":"#22c55e","--color-status-warn-text":"#f59e0b","--color-status-bad-text":"#ef4444","--color-compass-fill":"rgba(11, 61, 145, 0.95)","--color-compass-ring":"rgba(34, 211, 238, 0.45)","--color-compass-cardinal":"rgba(34, 211, 238, 0.3)","--color-compass-markers":"#7dd3fc","--color-compass-disc-bg":"#0a0de1"}',
  '2026-07-10T15:45:00.000Z'
);

INSERT INTO camera_slots (organizationId, slotNumber, label, url, updatedAt) VALUES
  ('org_shobdon', 1, 'Main camera', 'https://rtsp.me/embed/kesf3Ha8/', '2026-07-10T15:45:00.000Z'),
  ('org_shobdon', 2, 'Runway camera', '', '2026-07-10T15:45:00.000Z'),
  ('org_shobdon', 3, 'Clubhouse camera', '', '2026-07-10T15:45:00.000Z');
