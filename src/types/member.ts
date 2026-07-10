// owner: full access, can add/remove admin and atc members for their own
// tenant. admin: access to the future media-manager dashboard only.
// atc: access to the future ATC-control dashboard only. Plain strings on
// the wire (member.role in D1 has no enum constraint - see
// migrations/0002_organization_plugin.sql) - this union is a client-side
// convenience type, not a runtime-enforced schema.
export type MemberRole = 'owner' | 'admin' | 'atc'

export interface TenantMember {
  id: string
  role: string
  createdAt: string
  email: string
  name: string | null
}
