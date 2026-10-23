// "Log everyone out" for ONE tenant: deletes every active BetterAuth session
// (the `session` table) of that tenant's NON-developer members.
//
//  - Developers / platform admins (user.developer = 1) are never touched, so a
//    developer who is also a member of the tenant keeps their session.
//  - Other tenants' users are never touched: only members of THIS tenant's
//    organization are selected.
//  - A session belongs to a USER, not to a tenant (the cookie is per host but the
//    row is per user), so a non-developer who is a member of this tenant AND
//    another one is signed out of both and simply logs back in; the result
//    reports how many such users there were so the admin can see it.
//
// Used by the platform "Log everyone out" button and automatically by Suspend,
// so tabs already open (even on old code) are bounced to the login page the
// next time they re-check their session (window focus / tab visible) or make a
// request (401).
import type { D1Database } from "./tenantAuth";

export interface RevokeResult {
  users: number;
  sessions: number;
  alsoMemberOfOtherTenants: number;
}

const MEMBER_IDS_SQL = `
  SELECT m.userId FROM member m
  JOIN tenants t ON t.organization_id = m.organizationId
  JOIN user u ON u.id = m.userId
  WHERE t.id = ? AND COALESCE(u.developer, 0) = 0`;

export async function revokeNonDeveloperSessions(db: D1Database, tenantId: number): Promise<RevokeResult> {
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM (${MEMBER_IDS_SQL})) AS users,
              (SELECT COUNT(*) FROM session WHERE userId IN (${MEMBER_IDS_SQL})) AS sessions,
              (SELECT COUNT(*) FROM (${MEMBER_IDS_SQL}) x
                WHERE (SELECT COUNT(*) FROM member m2 WHERE m2.userId = x.userId) > 1) AS shared`
    )
    .bind(tenantId, tenantId, tenantId)
    .first<{ users: number; sessions: number; shared: number }>();

  await db.prepare(`DELETE FROM session WHERE userId IN (${MEMBER_IDS_SQL})`).bind(tenantId).run();

  return { users: counts?.users ?? 0, sessions: counts?.sessions ?? 0, alsoMemberOfOtherTenants: counts?.shared ?? 0 };
}
