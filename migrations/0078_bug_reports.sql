-- Platform-wide bug report board (/bug-reports) - mirrors migration
-- 0066's feature_requests exactly: one flat, SHARED list across every
-- tenant, no tenant_id scoping the row set itself. Any tenant owner/
-- admin can view the whole list and submit new entries; only the
-- developer role can change status (see functions/api/tenant/
-- bug-reports/[id].ts's own requireDeveloper gate).
--
-- id is a UUID (TEXT), same convention as feature_requests.
--
-- submitted_by_org_id/submitted_by_user_id: which tenant AND which
-- specific logged-in user submitted this - organization.id/user.id,
-- same identifiers feature_requests already uses. submitted_by_org_id
-- is what the table view's "submitted by (tenant)" column joins against
-- tenants.organization_id to resolve a display name.
CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported', -- 'reported' | 'working' | 'fixed' | 'parked'
  submitted_by_org_id TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
