-- Platform-wide feature request board (/features) - one flat, SHARED
-- list across every tenant, same "no tenant_id scoping the row set
-- itself" shape as platform_updates (migration 0050), not a per-org
-- table. Any tenant owner/admin can view the whole list and submit new
-- entries; only the developer role can change status (see
-- functions/api/tenant/feature-requests/[id].ts's own requireDeveloper
-- gate) - status is a shared, curated fact about the roadmap, not
-- something the submitter or any other tenant should be able to edit.
--
-- id is a UUID (TEXT), same convention as platform_updates/cameras/
-- site_relays rather than an AUTOINCREMENT int.
--
-- submitted_by_org_id/submitted_by_user_id: which tenant AND which
-- specific logged-in user submitted this - organization.id/user.id,
-- same identifiers member.organizationId/member.userId already use, not
-- a new id scheme. submitted_by_org_id is what the table view's
-- "submitted by (tenant)" column joins against tenants.organization_id
-- to resolve a display name.
CREATE TABLE IF NOT EXISTS feature_requests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea', -- 'idea' | 'planned' | 'built' | 'parked'
  submitted_by_org_id TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);
