// owner: full access, can add/remove admin/atc/media/cafe members for
// their own tenant. admin: access to the future media-manager dashboard
// only. atc: access to the future ATC-control dashboard only. media:
// access to a future dashboard that doesn't exist yet either (same
// "logged in, no dashboard to grant access to yet" situation as
// admin/atc when they were first added - RequireAuth's requireRole
// check already denies any non-allowed role identically, so no
// mechanism changes were needed to add this role, only the
// addable-role list). cafe: scoped to Cafe Media + Media Library only,
// nothing else - not even Dashboard Manager, which 'media' does get.
// Plain strings on the wire (member.role in D1 has no enum constraint -
// see migrations/0002_organization_plugin.sql) - this union is a
// client-side convenience type, not a runtime-enforced schema.
export type MemberRole = 'owner' | 'admin' | 'atc' | 'media' | 'cafe'

export interface TenantMember {
  id: string
  role: string
  createdAt: string
  email: string
  name: string | null
}
