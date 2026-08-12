import type { MemberRole } from '../../types/member'

// One item in the sidebar. allowedRoles is the visibility gate for
// ordinary tenant-role items; requireDeveloper is a separate gate for the
// cross-tenant developer flag (see AdminSidebar.tsx's isItemVisible) - an
// item should set exactly one of allowedRoles/requireDeveloper, never
// both. requireCafeEntitlement is orthogonal to both (a live fact from
// tenant_displays, not a role) and can combine with allowedRoles - Cafe
// Media needs both "one of these roles" AND "this tenant's cafe-tv
// display is entitled", not either alone.
export interface SidebarItem {
  to: string
  label: string
  allowedRoles?: MemberRole[]
  requireDeveloper?: boolean
  requireCafeEntitlement?: boolean
}

export interface SidebarGroupConfig {
  id: string
  label: string
  items: SidebarItem[]
}

// Single source of truth for the admin sidebar's structure. Adding a
// future admin page is just appending an item here (to an existing group,
// or a new group object) - nothing else in the sidebar needs to change.
export const SIDEBAR_GROUPS: SidebarGroupConfig[] = [
  {
    id: 'content',
    label: 'Content',
    items: [
      { to: '/media-manager', label: 'Dashboard Manager', allowedRoles: ['owner', 'admin', 'media'] },
      // 'cafe' role added here (not to Dashboard Manager above) - a
      // brand-new role scoped to exactly Cafe Media + Media Library,
      // nothing else. 'media' still deliberately excluded from Cafe
      // Media itself, unchanged from before this round.
      //
      // requireCafeEntitlement: task #40 - a tenant that no longer
      // administers its own café (entitlement off via /platform/tenants)
      // shouldn't see this item at all, for any role including owner.
      // CafeMediaPage.tsx already self-gates the route itself (shows
      // FeatureUpsellPanel instead of the editor when unentitled) - this
      // just keeps the sidebar from linking to that dead end.
      { to: '/cafe-media', label: 'Cafe Media', allowedRoles: ['owner', 'admin', 'cafe'], requireCafeEntitlement: true },
      // Split out of Dashboard Manager (which used to embed the whole
      // library UI below its carousel slots) into its own page, shared by
      // both Dashboard Manager and Cafe Media's Source dropdowns. Keeps
      // the 'media' role's existing access to library/upload work - that
      // role never had access to Cafe Media itself, so it doesn't gain
      // café-slot editing here, only what it already had (upload, tag,
      // organize, Edit Slide). 'cafe' added here too - the whole point
      // of that role is Cafe Media + Media Library together.
      { to: '/media-library', label: 'Media Library', allowedRoles: ['owner', 'admin', 'media', 'cafe'] },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [{ to: '/atc-control', label: 'ATC Control', allowedRoles: ['owner', 'admin', 'atc'] }],
  },
  {
    id: 'people',
    label: 'People',
    items: [{ to: '/members', label: 'Members', allowedRoles: ['owner', 'admin'] }],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { to: '/config', label: 'Weather Config', allowedRoles: ['owner', 'admin'] },
      { to: '/design', label: 'Screens Design', allowedRoles: ['owner', 'admin'] },
      { to: '/runways', label: 'Runways', allowedRoles: ['owner', 'admin'] },
      // Pilot Panel round - configures /pilot's own ticker + background
      // independently of the desktop dashboard. 'atc' included alongside
      // owner/admin (unlike every other item in this group) per its own
      // spec - matches the role list this page's RequireAuth and its
      // backing /api/tenant/pilot-view endpoint both use.
      { to: '/pilot-panel', label: 'Pilot Panel', allowedRoles: ['owner', 'admin', 'atc'] },
    ],
  },
  // Formerly an 11-item "Platform Admin" group listing every /platform/*
  // page individually - had grown too long for this sidebar. Collapsed to
  // one entry: clicking it lands on /platform/tenants (the most-used page,
  // confirmed as the intended default), which now sits inside
  // DeveloperLayout - its own persistent internal sidebar (see
  // DeveloperSidebar.tsx/developerSidebarConfig.ts) lists all 11 pages,
  // grouped by function, exactly like this one does for the main app.
  // requireDeveloper still gates visibility of this single entry here,
  // same mechanism as before - AdminSidebar.tsx's own isItemVisible is
  // unchanged.
  {
    id: 'platform',
    label: 'Platform Admin',
    items: [{ to: '/platform/tenants', label: 'Developer', requireDeveloper: true }],
  },
]

// Rendered below a divider, outside any group - isDeveloper is orthogonal
// to the role/group system, so it doesn't belong inside one. Support
// (renamed from Help) has neither allowedRoles nor requireDeveloper -
// visible to every logged-in role (isItemVisible's default), matching
// /help's own bare <RequireAuth>.
//
// Bug Reports and Feature Requests are both owner/admin-only
// (allowedRoles, same as /members), not developer-only - each is a
// platform-wide SHARED board any tenant admin can view and submit to,
// matching /bug-reports's and /features's own requireRole shape in
// App.tsx. Only status-editing (inside each page itself) is developer-
// gated, enforced server-side too - see functions/api/tenant/
// bug-reports/[id].ts and feature-requests/[id].ts.
export const STANDALONE_ITEMS: SidebarItem[] = [
  { to: '/help', label: 'Support' },
  { to: '/bug-reports', label: 'Bug Reports', allowedRoles: ['owner', 'admin'] },
  { to: '/features', label: 'Feature Requests', allowedRoles: ['owner', 'admin'] },
]
