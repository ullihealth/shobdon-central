-- Cross-tenant superadmin flag for the future developer/tenant-management
-- dashboard. Deliberately NOT modeled as an organization role (member.role
-- is scoped to one organizationId - a developer would need a membership
-- row in every single tenant to get in that way, which is backwards).
-- This is a separate, orthogonal axis: member.role answers "what can this
-- user do WITHIN a tenant they belong to"; this column answers "can this
-- user see/manage ALL tenants regardless of membership." Added via
-- BetterAuth's additionalFields mechanism (same pattern proven-ai uses
-- for its own user.role column) - plain SQLite boolean (0/1).
ALTER TABLE user ADD COLUMN developer INTEGER NOT NULL DEFAULT 0;
