import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
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
//
// Phone width: below the lg breakpoint the 256px sidebar would leave almost no
// room for the page, so it moves into a slide-in drawer opened from a slim top
// bar. From lg up the layout is exactly as before.
export default function DeveloperLayout(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100 lg:flex">
      <div className="sticky top-0 z-40 flex h-[52px] items-center border-b border-slate-800 bg-[#071229]/95 px-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open developer menu"
          aria-expanded={menuOpen}
          className="flex min-h-[44px] items-center gap-2 rounded-lg px-2 text-[16px] font-semibold text-slate-100"
        >
          <span aria-hidden="true">☰</span> Developer menu
        </button>
      </div>
      <div className="hidden lg:block">
        <DeveloperSidebar />
      </div>
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="bg-[#071229]">
            <DeveloperSidebar />
          </div>
          <button type="button" aria-label="Close developer menu" onClick={() => setMenuOpen(false)} className="flex-1 bg-slate-950/70" />
        </div>
      )}
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
