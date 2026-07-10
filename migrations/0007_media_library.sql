-- Media library: uploaded files (image/mp4/pdf) for the carousel
-- feature, decoupled from slot assignment - a file lives here
-- independently of whether/how many carousel slots reference it.
-- sizeBytes is tracked per row so total usage can be summed per tenant
-- (functions/api/tenant/media-library/index.ts) and checked against the
-- 100MB cap before any upload is accepted (functions/api/tenant/
-- media-library/upload.ts) - the check happens against this table's
-- SUM(sizeBytes), before the new file is written to R2, not after.
CREATE TABLE IF NOT EXISTS media_library (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  r2Key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mediaType TEXT NOT NULL, -- 'image' | 'mp4' | 'pdf'
  sizeBytes INTEGER NOT NULL,
  mp4DurationSeconds REAL,
  uploadedAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_media_library_org ON media_library(organizationId);
