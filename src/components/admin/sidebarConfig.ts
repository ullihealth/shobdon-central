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
    id: 'settings',
    label: 'Settings',
    items: [{ to: '/config', label: 'Weather Config', allowedRoles: ['owner', 'admin'] }],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { to: '/design', label: 'Dashboard Design', allowedRoles: ['owner', 'admin'] },
      { to: '/runways', label: 'Runways', allowedRoles: ['owner', 'admin'] },
      { to: '/media-manager', label: 'Media Manager', allowedRoles: ['owner', 'admin', 'media'] },
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
]

// Rendered below a divider, outside any group - isDeveloper is orthogonal
// to the role/group system, so it doesn't belong inside one.
export const STANDALONE_ITEMS: SidebarItem[] = [{ to: '/developertools', label: 'Developer Tools', requireDeveloper: true }]
