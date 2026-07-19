-- Media Library restructure: usage tags on media_library (which
-- screen(s) an asset is usable on, and its orientation) plus a
-- genuinely separate cafe_carousel_slots table - confirmed with the
-- user this should be an independent set of 12 slots (a tenant can run
-- different content on their clubhouse TV vs their café TV at the same
-- time), not a second UI surface over the same rows carousel_slots
-- already has.
--
-- usableOn defaults 'dashboard' for EXISTING rows - per instruction,
-- nothing currently assigned to a dashboard slot should change meaning.
-- orientation defaults '16:9' for EXISTING rows - genuine dimension-
-- based auto-detection isn't possible here: media_library has never
-- stored width/height for uploaded files (confirmed - no such column in
-- any prior migration), so there is nothing to detect for files already
-- uploaded. '16:9' is the safe default (matches the aspect ratio every
-- existing dashboard slot/panel was actually designed for). Genuine
-- auto-detection is implemented going forward, client-side, at upload
-- time (MediaLibraryPage.tsx's upload handler, mirroring how
-- mp4DurationSeconds is already probed client-side before upload) - the
-- value it computes is simply what gets INSERTed for new rows; this
-- migration only backfills existing ones with a static default.
ALTER TABLE media_library ADD COLUMN usableOn TEXT NOT NULL DEFAULT 'dashboard'; -- 'dashboard' | 'cafe' | 'both'
ALTER TABLE media_library ADD COLUMN orientation TEXT NOT NULL DEFAULT '16:9'; -- '16:9' | '9:16' | 'both'

-- Exact structural mirror of carousel_slots (base 0008 + fitMode 0017 +
-- crop/rotation/brightness/banner 0018 + zone 0033), a parallel table
-- rather than a foreign-keyed variant or a shared table with a screen
-- discriminator column, so CafeTemplate.tsx's read path and a new
-- cafe-carousel API route's validation/upsert logic can closely mirror
-- the existing carousel/index.ts rather than needing a discriminator
-- threaded through every existing query and call site - keeps
-- carousel_slots and every one of its current call sites completely
-- untouched, zero regression risk to the live dashboard carousel.
--
-- zone is kept here too (not dropped) even though café's own layout
-- mode is what determines whether split-pane zones are meaningful at
-- all - a café-specific slot can still be assigned left/right/both
-- exactly like today's shared table, just scoped to café's own slot
-- set instead of the dashboard's.
CREATE TABLE IF NOT EXISTS cafe_carousel_slots (
  organizationId TEXT NOT NULL,
  slotNumber INTEGER NOT NULL CHECK (slotNumber BETWEEN 1 AND 12),
  enabled INTEGER NOT NULL DEFAULT 0,
  mediaType TEXT NOT NULL DEFAULT 'image', -- 'image' | 'mp4' | 'pdf' | 'webcam'
  durationSeconds INTEGER NOT NULL DEFAULT 10,
  mediaLibraryId TEXT,
  cameraSlotNumber INTEGER,
  fitMode TEXT NOT NULL DEFAULT 'contain',
  cropX REAL NOT NULL DEFAULT 0,
  cropY REAL NOT NULL DEFAULT 0,
  cropWidth REAL NOT NULL DEFAULT 100,
  cropHeight REAL NOT NULL DEFAULT 100,
  rotationDegrees REAL NOT NULL DEFAULT 0,
  brightnessPercent REAL NOT NULL DEFAULT 100,
  bannerText TEXT NOT NULL DEFAULT '',
  bannerOpacity REAL NOT NULL DEFAULT 70,
  bannerFontSize TEXT NOT NULL DEFAULT 'md',
  zone TEXT NOT NULL DEFAULT 'both', -- 'both' | 'left' | 'right' - meaningful when cafe_template_settings.layoutMode = 'split'
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (organizationId, slotNumber),
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
  FOREIGN KEY (mediaLibraryId) REFERENCES media_library(id)
);
