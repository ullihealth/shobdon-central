-- Lightweight, user-defined folder organization for the media library -
-- a flat list (no nesting), scoped per tenant. folderId on media_library
-- has no inline REFERENCES, matching this codebase's existing convention
-- (see carousel_slots' mediaLibraryId comment in migration 0008) of
-- enforcing the relation at the app level in the route handler rather
-- than a SQL constraint.
--
-- folderId IS NULL is the virtual "Uncategorized" bucket - not a real
-- row, always shown first in the UI, can't be deleted/renamed. Every
-- existing file already satisfies this the instant this column is
-- added (defaults to NULL), so there's no backfill step and nothing
-- that can fail partway through this migration.
CREATE TABLE IF NOT EXISTS media_folders (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  name TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_media_folders_org ON media_folders(organizationId);

ALTER TABLE media_library ADD COLUMN folderId TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_media_library_folder ON media_library(folderId);
