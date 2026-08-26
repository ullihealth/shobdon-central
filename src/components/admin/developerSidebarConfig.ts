import type { SidebarGroupConfig } from './sidebarConfig'

// Single source of truth for DeveloperSidebar.tsx's structure - same
// "adding a page is just appending an item here" intent as
// sidebarConfig.ts's own SIDEBAR_GROUPS, reusing that exact
// SidebarGroupConfig/SidebarItem shape (and SidebarGroup.tsx itself,
// unmodified) rather than inventing a second nav-config format. Every
// item here shares the identical requireDeveloper gate - enforced once,
// at the DeveloperLayout route level in App.tsx - so unlike
// SIDEBAR_GROUPS, no item needs its own allowedRoles/requireDeveloper
// field.
//
// Grouped by function, not the previous flat/arbitrary sidebar order:
// tenant/business management, monitoring/diagnostics, product/release
// management, and general tools.
export const DEVELOPER_SIDEBAR_GROUPS: SidebarGroupConfig[] = [
  {
    id: 'tenants',
    label: 'Tenants & Business',
    items: [
      { to: '/platform/tenants', label: 'Platform Tenants' },
      { to: '/platform/cafe-carousel-owner-slots', label: 'Café Reserved Slots' },
      { to: '/platform/preview', label: 'Tenant Preview' },
      { to: '/platform/onboarding-content', label: 'Onboarding Content' },
      { to: '/platform/cameras', label: 'Cameras' },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoring & Diagnostics',
    items: [
      { to: '/platform/visits', label: 'Visit Log' },
      { to: '/platform/known-devices', label: 'Known Devices' },
      { to: '/platform/uptime-report', label: 'Uptime Report' },
      { to: '/platform/ip-directory', label: 'IP Directory' },
      { to: '/platform/capture-history', label: 'Capture History' },
    ],
  },
  {
    id: 'product',
    label: 'Product & Release',
    items: [
      { to: '/platform/updates', label: 'Developer Updates' },
      { to: '/platform/dev-features', label: 'Developer Features' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [{ to: '/developertools', label: 'Developer Tools' }],
  },
]
