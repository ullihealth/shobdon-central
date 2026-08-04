import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DEVELOPER_SIDEBAR_GROUPS } from './developerSidebarConfig'
import SidebarGroup from './SidebarGroup'

const COLLAPSE_STORAGE_KEY = 'shobdon.developerSidebar.collapsedGroups.v1'

function loadCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// Persistent left sidebar for every /platform/* + /developertools page -
// same visual/structural pattern as AdminSidebar.tsx (sticky, h-screen,
// SidebarGroup reused unmodified), deliberately simpler: every item here
// shares one gate (requireDeveloper, applied once at the DeveloperLayout
// route level in App.tsx), so unlike AdminSidebar there's no per-item
// role/entitlement filtering, and therefore no need for this component
// to fetch /api/tenant/me itself at all - reaching this component's
// render already proves the caller is a developer.
export default function DeveloperSidebar(): JSX.Element {
  const location = useLocation()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => loadCollapsedGroups())

  function toggleGroup(id: string) {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Collapse state is a convenience, not critical - fine to lose it.
      }
      return next
    })
  }

  // Platform Tenants' own sub-route (/platform/tenants/:id/carousel-owner-slots,
  // reached via a Link from PlatformTenantsPage.tsx, not a sidebar item of
  // its own) should still highlight "Platform Tenants" as active, rather
  // than nothing at all - SidebarGroup's own active check is a plain
  // equality match, so that sub-route's path is normalised back to its
  // parent item's path before being passed down.
  const activePath = location.pathname.startsWith('/platform/tenants/') ? '/platform/tenants' : location.pathname

  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950/60">
      <div className="px-5 pb-4 pt-6">
        <Link to="/" className="mb-1 block text-xs font-semibold text-muted-400 transition hover:text-accent-sky-400">
          ← Back to Dashboard
        </Link>
        <div className="text-lg font-black uppercase tracking-wide text-primary">Developer</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {DEVELOPER_SIDEBAR_GROUPS.map((group) => {
          const hasActiveItem = group.items.some((item) => item.to === activePath)
          const collapsed = !hasActiveItem && !!collapsedGroups[group.id]
          return (
            <SidebarGroup
              key={group.id}
              group={group}
              activePath={activePath}
              collapsed={collapsed}
              onToggle={() => toggleGroup(group.id)}
            />
          )
        })}
      </nav>
    </aside>
  )
}
