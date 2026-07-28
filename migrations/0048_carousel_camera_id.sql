-- Links carousel slots to the new cameras table (migration 0047),
-- alongside (not replacing) the existing cameraSlotNumber column that
-- points at the older camera_slots table. A slot has at most one of the
-- two set - functions/api/_utils/publicConfig.ts checks cameraId first
-- when resolving a 'webcam' slot's playback URL, falling back to the
-- legacy cameraSlotNumber/camera_slots lookup otherwise. No FK
-- constraint enforced (SQLite doesn't enforce them unless PRAGMA
-- foreign_keys=ON, which this schema doesn't set - same posture as
-- cameras.site_relay_id itself).
ALTER TABLE carousel_slots ADD COLUMN cameraId TEXT;
ALTER TABLE cafe_carousel_slots ADD COLUMN cameraId TEXT;
