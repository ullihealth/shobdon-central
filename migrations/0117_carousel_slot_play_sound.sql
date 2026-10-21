-- Optional sound for carousel videos: a per-slot "Play sound" switch, on both
-- slot tables (the Dashboard Manager's carousel_slots and Cafe Media's
-- cafe_carousel_slots, which share the same editor).
--
-- Default 0 (muted) for every existing row, so nothing changes for any tenant
-- until someone turns a slot's switch on. Only a live dashboard/cafe screen
-- ever honours it; admin previews, the Pilot's App and Media Library
-- thumbnails stay muted. See src/utils/videoSound.ts for the unmuted -> muted
-- fallback when a browser blocks autoplay with sound.
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the code - the public
-- config and both slot routes SELECT this column, so code that ships first
-- would fail on the missing column.
ALTER TABLE carousel_slots ADD COLUMN playSound INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cafe_carousel_slots ADD COLUMN playSound INTEGER NOT NULL DEFAULT 0;
