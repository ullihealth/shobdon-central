-- Retroactive guarantee: the developer account (jeffthompson@europe.com,
-- user.developer = 1) must be an owner-level member of every tenant.
-- For shobdon this is already true from the original seed
-- (0005_seed_shobdon.sql inserted usr_jeff as org_shobdon's owner
-- directly) - this migration is a guarded no-op confirming that, not a
-- fresh insert. It exists so the *pattern* is codified as a real,
-- checkable migration rather than an assumption that happens to hold
-- for tenant #1 by coincidence.
--
-- IMPORTANT - repeat this pattern for every future tenant: there is no
-- BetterAuth plugin hook for "run this after organization.create"
-- (confirmed by inspecting node_modules/better-auth/dist/plugins/
-- organization/organization.mjs - no beforeCreate/afterCreate option
-- exists in the installed version). Whatever endpoint eventually handles
-- onboarding a new airfield MUST explicitly insert a 'owner' member row
-- for the developer user immediately after creating the organization
-- row - this does not happen automatically.
INSERT INTO member (id, organizationId, userId, role, createdAt)
SELECT 'mem_dev_shobdon_retro', 'org_shobdon', 'usr_jeff', 'owner', '2026-07-11T00:00:00.000Z'
WHERE NOT EXISTS (
  SELECT 1 FROM member
  WHERE organizationId = 'org_shobdon' AND userId = 'usr_jeff' AND role = 'owner'
);
