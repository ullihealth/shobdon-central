import type { MemberRole } from '../../types/member'

// One item in the sidebar. allowedRoles is the visibility gate for
// ordinary tenant-role items; requireDeveloper is a separate gate for the
// cross-tenant developer flag (see AdminSidebar.tsx's isItemVisible) - an
// item should set exactly one of the two, never both.
export interface SidebarItem {
  to: string
  label: string
  allowedRoles?: MemberRole[]
  requireDeveloper?: boolean
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
      { to: '/cafe-media', label: 'Cafe Media', allowedRoles: ['owner', 'admin'] },
      // Split out of Dashboard Manager (which used to embed the whole
      // library UI below its carousel slots) into its own page, shared by
      // both Dashboard Manager and Cafe Media's Source dropdowns. Keeps
      // the 'media' role's existing access to library/upload work - that
      // role never had access to Cafe Media itself, so it doesn't gain
      // café-slot editing here, only what it already had (upload, tag,
      // organize, Edit Slide).
      { to: '/media-library', label: 'Media Library', allowedRoles: ['owner', 'admin', 'media'] },
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
    ],
  },
  // Cross-tenant, requireDeveloper-only pages - previously scattered
  // (Developer Tools was the only one with any nav entry at all;
  // /platform/tenants and /platform/onboarding-content existed in code,
  // properly gated server-side, but had zero sidebar entry anywhere, so
  // reaching them meant already knowing the exact URL). Grouped here
  // instead of left as standalone items: AdminSidebar.tsx's own
  // visibleGroups filter already drops a group entirely once every one
  // of its items fails isItemVisible, so this whole group correctly
  // disappears for a non-developer user with no code beyond this list -
  // same per-item requireDeveloper flag Developer Tools already used,
  // not a new gating mechanism.
  {
    id: 'platform',
    label: 'Platform Admin',
    items: [
      { to: '/platform/tenants', label: 'Platform Tenants', requireDeveloper: true },
      { to: '/platform/onboarding-content', label: 'Onboarding Content', requireDeveloper: true },
      { to: '/platform/visits', label: 'Visit Log', requireDeveloper: true },
      { to: '/developertools', label: 'Developer Tools', requireDeveloper: true },
    ],
  },
]

// Rendered below a divider, outside any group - isDeveloper is orthogonal
// to the role/group system, so it doesn't belong inside one. Help has
// neither allowedRoles nor requireDeveloper - visible to every logged-in
// role (isItemVisible's default), matching /help's own bare <RequireAuth>.
export const STANDALONE_ITEMS: SidebarItem[] = [{ to: '/help', label: 'Help' }]
