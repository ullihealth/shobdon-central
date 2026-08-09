import { Outlet } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import DevPreviewBanner from './DevPreviewBanner'

// Shared shell for every authenticated admin page (/config, /design,
// /runways, /members, /media-manager, /atc-control, /account,
// /developertools) - rendered once as a React Router layout route wrapping
// all of them, replacing each page's own previously-duplicated header/back-
// link/account row. Per-route access gating (RequireAuth) is unchanged and
// still wraps each individual child route in App.tsx - this component only
// owns the persistent nav chrome, nothing about auth.
export default function AdminLayout(): JSX.Element {
  return (
    <div className="flex min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to text-slate-100">
      <AdminSidebar />
      <main className="min-w-0 flex-1">
        {/* Renders null for every ordinary tenant admin - only shows when
            the page currently being administered doesn't match the host
            in the address bar (see that component's own comment for the
            full detection logic). Its own sticky top-0 keeps it pinned
            at the top of THIS scroll container as a long admin page
            scrolls, rather than a page-level fixed overlay that would
            need its own z-index coordination against every page's own
            content. */}
        <DevPreviewBanner />
        <Outlet />
      </main>
    </div>
  )
}
