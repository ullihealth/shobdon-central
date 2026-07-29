-- Internal, app-wide running changelog for Platform Admin's new
-- "Developer Updates" page - deliberately NOT tenant-facing (no
-- tenant_id column at all; this is one flat list for the whole app, not
-- per-org). status moves draft -> reviewed -> released; version is only
-- ever assigned at release time (a batch of reviewed entries gets
-- stamped with one version number together, see the release endpoint),
-- so it stays NULL for draft/reviewed rows by design, not an oversight.
-- id is a UUID (TEXT), same convention as cameras/site_relays rather
-- than an AUTOINCREMENT int - entries are created directly by whoever's
-- wrapping up a change (see this feature's own PlatformUpdatesPage.tsx),
-- not derived from any other table's own row.
CREATE TABLE IF NOT EXISTS platform_updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'reviewed' | 'released'
  version TEXT, -- e.g. '1.4.0' - NULL until released
  created_at TEXT NOT NULL,
  released_at TEXT -- NULL until released
);

CREATE INDEX IF NOT EXISTS idx_platform_updates_status ON platform_updates(status);
CREATE INDEX IF NOT EXISTS idx_platform_updates_version ON platform_updates(version);
