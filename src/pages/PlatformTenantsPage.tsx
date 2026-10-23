import { useEffect, useState } from 'react'
import { Outlet, useOutletContext } from 'react-router-dom'
import { TenantsProvider, useTenants } from '../components/platform/tenants/TenantsContext'
import QuickSwitcher from '../components/platform/tenants/QuickSwitcher'

// Layout route for /platform/tenants (the searchable list) and
// /platform/tenants/:slug (one tenant, deep-linkable). Both children share one
// copy of the tenant data (TenantsProvider), so switching tenant never
// refetches and the browser Back button just moves between the same data.
// Cmd/Ctrl+K opens the quick switcher from anywhere on these pages.
export interface PlatformTenantsOutletContext {
  openSwitcher: () => void
}

export function usePlatformTenantsOutlet(): PlatformTenantsOutletContext {
  return useOutletContext<PlatformTenantsOutletContext>()
}

function Shell(): JSX.Element {
  const { forbidden } = useTenants()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // Static title - this page had no document.title of its own, so its
  // tab was permanently stuck on index.html's generic default.
  useEffect(() => {
    document.title = 'Platform Tenants - Airfield Central'
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSwitcherOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-page-from via-page-via to-page-to px-4 text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-8 text-center shadow-xl shadow-slate-950/20">
          <h1 className="mb-3 text-xl font-black uppercase tracking-wide text-status-bad">Not authorized</h1>
          <p className="text-sm text-muted-400">Platform admin access required.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dev-type">
      <Outlet context={{ openSwitcher: () => setSwitcherOpen(true) } satisfies PlatformTenantsOutletContext} />
      <QuickSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </div>
  )
}

export default function PlatformTenantsPage(): JSX.Element {
  return (
    <TenantsProvider>
      <Shell />
    </TenantsProvider>
  )
}
