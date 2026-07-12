import { Outlet } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'

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
        <Outlet />
      </main>
    </div>
  )
}
