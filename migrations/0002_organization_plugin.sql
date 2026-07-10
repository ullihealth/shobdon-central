-- BetterAuth's official "organization" plugin schema - column shapes
-- confirmed from the plugin's own source (node_modules/better-auth/dist/
-- plugins/organization/schema.mjs), not guessed. This plugin's
-- `organization` table IS this project's "tenants" concept - Shobdon
-- becomes the first row, other airfields become additional rows in a
-- future phase. `member` links a user to an organization with a role
-- (default roles: owner/admin/member - open-ended strings, not an enum,
-- so no schema change is needed to introduce new role names later).
-- `invitation` is unused in phase 0 but costs nothing to create now and
-- is required groundwork for inviting other airfields' admins later.

CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  metadata TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  userId TEXT NOT NULL,
  role TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invitation (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  teamId TEXT,
  inviterId TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
  FOREIGN KEY (inviterId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_member_org ON member(organizationId);
CREATE INDEX IF NOT EXISTS idx_member_user ON member(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_org_user ON member(organizationId, userId);
CREATE INDEX IF NOT EXISTS idx_invitation_org ON invitation(organizationId);
