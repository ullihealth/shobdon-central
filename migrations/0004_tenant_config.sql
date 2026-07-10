-- Tenant-scoped replacement for what used to be per-browser localStorage
-- (clubProfileStore.ts: runwayGroups, webcamUrl) and unscoped global
-- Worker KV (the 'theme' key). Scoping everything by organizationId (the
-- tenant) is what actually fixes the PC2-vs-laptop sync gap: reads now
-- come from one shared row set instead of whichever browser last wrote
-- to its own localStorage.
--
-- No separate "club_profile" table: the only flat club-level facts that
-- existed (name, effectively a slug) already live on `organization`
-- itself. runway_groups / club_theme / camera_slots below fully cover
-- what ClubProfile + the theme KV key used to hold.

-- One row per tenant. tokens_json holds the full theme token set as a
-- single JSON object (matches how it was already handled as one
-- GET/POST'd blob via the Worker's 'theme' KV key - no per-token
-- granularity is needed since it's always read/written as a whole set).
CREATE TABLE IF NOT EXISTS club_theme (
  organizationId TEXT PRIMARY KEY,
  tokensJson TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);

-- One row per runway group (was RunwayGroup[] in localStorage). Strips
-- stay as a JSON array (stripsJson) rather than a separate normalized
-- table - they're a tightly-coupled nested list specific to one group,
-- always read/written together, with no independent query need, so a
-- separate runway_strips table would add relational complexity (FKs,
-- ordering) for no real benefit at this stage. sortOrder preserves the
-- "Runway 1/2/3" display order that used to be implicit in array order.
CREATE TABLE IF NOT EXISTS runway_groups (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  label TEXT NOT NULL,
  headingDegrees REAL NOT NULL,
  twin INTEGER NOT NULL,
  stripLengthPx REAL NOT NULL,
  identifierFontSizePx REAL NOT NULL,
  stripsJson TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_runway_groups_org ON runway_groups(organizationId);

-- Fixed 3 labelled camera slots per tenant, replacing the single
-- webcamUrl string. Labels are editable, not fixed to "Apron/Runway/
-- Clubhouse" - those are just the seeded defaults' suggested names.
-- Empty url means that slot isn't configured yet (mirrors the old
-- empty-string-means-unset convention for webcamUrl).
CREATE TABLE IF NOT EXISTS camera_slots (
  organizationId TEXT NOT NULL,
  slotNumber INTEGER NOT NULL CHECK (slotNumber BETWEEN 1 AND 3),
  label TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (organizationId, slotNumber),
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
);
