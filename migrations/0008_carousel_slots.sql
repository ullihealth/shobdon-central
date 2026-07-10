-- 12 fixed carousel slots per tenant - same composite-PK/CHECK/CASCADE
-- shape as camera_slots (migrations/0004_tenant_config.sql), not a new
-- storage paradigm. Slots are decoupled from the media library:
-- mediaLibraryId is a reference, not a copy - assigning a slot to a
-- library file is a metadata-only update here, no file is touched.
--
-- mediaLibraryId is only meaningful for mediaType 'image'/'mp4'/'pdf';
-- cameraSlotNumber (1-3, referencing the EXISTING camera_slots table -
-- not duplicating its URL) is only meaningful for mediaType 'webcam'.
-- No CHECK enforcing that mutual exclusivity at the DB level - kept as
-- an application-level invariant (functions/api/tenant/carousel/
-- index.ts's PUT handler), consistent with how this project already
-- keeps cross-field validation in the route handlers rather than SQL
-- CHECK constraints elsewhere (e.g. runway_groups' strip/twin
-- relationship).
CREATE TABLE IF NOT EXISTS carousel_slots (
  organizationId TEXT NOT NULL,
  slotNumber INTEGER NOT NULL CHECK (slotNumber BETWEEN 1 AND 12),
  enabled INTEGER NOT NULL DEFAULT 0,
  mediaType TEXT NOT NULL DEFAULT 'image', -- 'image' | 'mp4' | 'pdf' | 'webcam'
  durationSeconds INTEGER NOT NULL DEFAULT 10,
  mediaLibraryId TEXT,
  cameraSlotNumber INTEGER,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (organizationId, slotNumber),
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
  FOREIGN KEY (mediaLibraryId) REFERENCES media_library(id)
);
