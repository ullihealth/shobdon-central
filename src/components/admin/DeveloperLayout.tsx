import { Outlet } from 'react-router-dom'
import DeveloperSidebar from './DeveloperSidebar'

// Shared shell for the 11 platform-admin pages previously scattered
// across the main sidebar's own "Platform Admin" group (now collapsed to
// a single "Developer" entry - see sidebarConfig.ts) - same exact
// structure as AdminLayout.tsx (sticky sidebar + flex-1 <Outlet/>), a
// deliberate mirror rather than a new layout mechanism. Rendered as its
// own top-level route wrapper in App.tsx (RequireAuth requireDeveloper
// applied ONCE around this whole block, not per child route - every
// child here already shared that identical gate, so consolidating it is
// a clean simplification, unlike AdminLayout's own children which need
// different role gates and so keep theirs individually).
//
// Deliberately NOT nested inside AdminLayout/AdminSidebar - that would
// leave only AdminLayout's own flex-1 width for this sidebar+content
// pair to share, when every child page here already assumes the full
// viewport width (several use their own wide internal max-w, e.g.
// PlatformTenantsPage.tsx's max-w-[1900px] two-pane layout).
export default function DeveloperLayout(): JSX.Element {
  return (
    <div className="flex min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <DeveloperSidebar />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
