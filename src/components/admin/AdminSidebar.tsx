import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { MemberRole } from '../../types/member'
import { SIDEBAR_GROUPS, STANDALONE_ITEMS, type SidebarItem } from './sidebarConfig'
import SidebarGroup from './SidebarGroup'
import SidebarUserMenu from './SidebarUserMenu'
import OrgSwitcher, { type MembershipSummary } from './OrgSwitcher'

const COLLAPSE_STORAGE_KEY = 'shobdon.adminSidebar.collapsedGroups.v1'

function loadCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function isItemVisible(item: SidebarItem, role: MemberRole | null, isDeveloper: boolean): boolean {
  if (item.requireDeveloper) return isDeveloper
  if (item.allowedRoles) return !!role && item.allowedRoles.includes(role)
  return true
}

// Own independent GET /api/tenant/me fetch - the same shape RequireAuth.tsx
// already uses for per-route gating, but deliberately not shared with it.
// This is a purely presentational nav layer; keeping it decoupled means
// the already-tested access-control gate in RequireAuth.tsx stays
// completely untouched by this change, at the cost of one extra
// lightweight JSON request per admin page load.
export default function AdminSidebar(): JSX.Element {
  const location = useLocation()
  const [role, setRole] = useState<MemberRole | null>(null)
  const [isDeveloper, setIsDeveloper] = useState(false)
  const [loading, setLoading] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => loadCollapsedGroups())
  const [organizationName, setOrganizationName] = useState('Shobdon Airfield')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [memberships, setMemberships] = useState<MembershipSummary[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setRole(data?.role ?? null)
        setIsDeveloper(!!data?.isDeveloper)
        if (data?.organizationName) setOrganizationName(data.organizationName)
        setOrganizationSlug(data?.organizationSlug ?? '')
        setMemberships(Array.isArray(data?.memberships) ? data.memberships : [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  const visibleGroups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isItemVisible(item, role, isDeveloper)),
  })).filter((group) => group.items.length > 0)

  const visibleStandalone = STANDALONE_ITEMS.filter((item) => isItemVisible(item, role, isDeveloper))

  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950/60">
      {/* Without sticky+h-screen, this flex-row's default align-items:
          stretch makes <aside> match <main>'s content height - on pages
          taller than one viewport (e.g. ATC Control), that stretched the
          whole sidebar past the fold and pushed SidebarUserMenu off-screen
          entirely. h-screen locks it to one viewport; sticky keeps it
          pinned while <main> scrolls independently. */}
      <div className="px-5 pb-4 pt-6">
        <Link to="/" className="text-lg font-black uppercase tracking-wide text-primary transition hover:text-accent-sky-400">
          {organizationName}
        </Link>
      </div>

      {!loading && (
        <>
          <OrgSwitcher memberships={memberships} activeOrgSlug={organizationSlug} />

          <nav className="flex-1 overflow-y-auto px-3 pb-4">
            {visibleGroups.map((group) => {
              // The active item's group always renders open, even if the
              // user previously collapsed it - never hide the page you're
              // currently on behind its own group's collapse state.
              const hasActiveItem = group.items.some((item) => item.to === location.pathname)
              const collapsed = !hasActiveItem && !!collapsedGroups[group.id]
              return (
                <SidebarGroup
                  key={group.id}
                  group={group}
                  activePath={location.pathname}
                  collapsed={collapsed}
                  onToggle={() => toggleGroup(group.id)}
                />
              )
            })}

            {visibleStandalone.length > 0 && (
              <div className="mt-4 flex flex-col gap-0.5 border-t border-slate-800 pt-4">
                {visibleStandalone.map((item) => {
                  const active = item.to === location.pathname
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`block rounded-lg py-2 pl-[17px] pr-3 text-sm font-semibold transition ${
                        active ? 'bg-accent-sky-500/15 text-accent-sky-400' : 'text-slate-300 hover:bg-slate-900/80 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </nav>

          <SidebarUserMenu activePath={location.pathname} />
        </>
      )}
    </aside>
  )
}
