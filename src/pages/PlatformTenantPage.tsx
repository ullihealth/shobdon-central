import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTenants } from '../components/platform/tenants/TenantsContext'
import { usePlatformTenantsOutlet } from './PlatformTenantsPage'
import {
  ForcePilotUpdateButton,
  RefreshDisplaysButton,
  TENANTS_URL,
  formatDate,
  useLogEveryoneOut,
  type PlatformTenant,
} from '../components/platform/tenants/tenantEditors'
import { StatusBadge, TenantAvatar } from '../components/platform/tenants/TenantUi'
import {
  BillingTab,
  DevicesTab,
  InternalTab,
  MembersTab,
  OverviewTab,
  ProductsTab,
  TABS,
  WeatherTab,
  isTabKey,
  type TabKey,
} from '../components/platform/tenants/TenantTabs'
import { isArchived, planBadge, rememberRecentTenant, statusBadges } from '../components/platform/tenants/tenantStatus'

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

// Archiving is the most destructive thing on this page that can still be
// undone by a developer, so it asks for the tenant's name rather than a plain OK.
function ArchiveDialog({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }): JSX.Element {
  const { handleArchiveTenant } = useTenants()
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)
  const matches = typed.trim() === tenant.name.trim()

  async function confirm() {
    if (!matches || working) return
    setWorking(true)
    setFailed(false)
    const ok = await handleArchiveTenant(tenant)
    setWorking(false)
    if (ok) onClose()
    else setFailed(true)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        className="w-full max-w-md rounded-2xl border border-red-400/40 bg-slate-950 p-6 shadow-2xl"
      >
        <h2 id="archive-title" className="mb-2 text-lg font-black text-red-200">
          Archive {tenant.name}?
        </h2>
        <p className="mb-4 text-sm text-slate-200">
          This goes further than suspending - their own team will be locked out of their back-office immediately too, not
          just the public dashboard. A "Permanently delete" option will appear on the Internal tab once this completes.
        </p>
        <label htmlFor="archive-confirm" className="mb-1 block text-xs font-semibold uppercase tracking-widest text-muted-300">
          Type the tenant name to confirm
        </label>
        <input
          id="archive-confirm"
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirm()
          }}
          placeholder={tenant.name}
          className="mb-3 min-h-[44px] w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-muted-400 focus:border-red-400 focus:outline-none"
        />
        {failed && <p className="mb-3 text-sm font-semibold text-red-200">Archiving failed. Nothing was changed.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-400">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!matches || working}
            className="min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-500 disabled:opacity-40"
          >
            {working ? 'Archiving…' : 'Archive tenant'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MoreMenu({ tenant, onArchive }: { tenant: PlatformTenant; onArchive: () => void }): JSX.Element {
  const { handleSuspendToggle } = useTenants()
  const logout = useLogEveryoneOut(tenant)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const archived = isArchived(tenant)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item =
    'flex min-h-[44px] w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-slate-800/70 disabled:opacity-50'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="min-h-[44px] rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-slate-400"
      >
        More ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-slate-950 p-2 shadow-2xl">
          <div className="md:hidden">
            <div className="px-3 pb-1 pt-1 text-xs font-bold uppercase tracking-widest text-muted-300">Devices</div>
            <div className="flex flex-col gap-2 px-2 pb-2">
              <RefreshDisplaysButton tenant={tenant} />
              <ForcePilotUpdateButton tenant={tenant} />
            </div>
          </div>
          <div className="px-3 pb-1 pt-1 text-xs font-bold uppercase tracking-widest text-red-200">Danger zone</div>
          {archived ? (
            <p className="px-3 py-2 text-xs text-muted-300">
              Archived {tenant.deletedAt ? formatDate(tenant.deletedAt) : ''}. Suspend, Resume and Archive are unavailable.
            </p>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className={`${item} text-red-200`}
                onClick={() => {
                  setOpen(false)
                  handleSuspendToggle(tenant)
                }}
              >
                {tenant.active ? 'Suspend tenant' : 'Resume tenant'}
              </button>
              <button type="button" role="menuitem" className={`${item} text-red-200`} disabled={logout.status === 'loading'} onClick={() => void logout.run()}>
                {logout.status === 'loading'
                  ? 'Logging out…'
                  : logout.status === 'success'
                    ? `Logged out ✓ ${logout.detail}`
                    : logout.status === 'error'
                      ? 'Failed - retry'
                      : 'Log everyone out'}
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${item} text-red-200`}
                onClick={() => {
                  setOpen(false)
                  onArchive()
                }}
              >
                Archive tenant…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// /platform/tenants/:slug - one tenant: sticky header, then tabs.
export default function PlatformTenantPage(): JSX.Element {
  const { slug } = useParams()
  const { tenants, loading, handleHardDeleted } = useTenants()
  const { openSwitcher } = usePlatformTenantsOutlet()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [parentSlug, setParentSlug] = useState<string | null>(null)

  const tenant = tenants.find((t) => t.slug === slug) ?? null
  const tabParam = params.get('tab')
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'overview'

  useEffect(() => {
    if (tenant) rememberRecentTenant(tenant.slug)
  }, [tenant?.slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Parent airfield comes from its own existing route (it is not on the tenant
  // list), fetched per tenant so the header and Overview can show it.
  useEffect(() => {
    if (!tenant) return
    let cancelled = false
    setParentSlug(null)
    fetch(`${TENANTS_URL}/${tenant.id}/parent-tenant`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setParentSlug(data?.parentTenantSlug ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tenant?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tenant) document.title = `${tenant.name} - Platform Tenants - Airfield Central`
  }, [tenant?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="px-6 py-10 text-sm text-muted-400">Loading…</div>
  }

  if (!tenant) {
    return (
      <div className="px-6 py-10">
        <h1 className="mb-2 text-xl font-black text-white">Tenant not found</h1>
        <p className="mb-4 max-w-lg text-sm text-muted-300">
          There is no live tenant with the slug "{slug}". Archived tenants no longer appear after a page reload.
        </p>
        <Link to="/platform/tenants" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          ← All tenants
        </Link>
      </div>
    )
  }

  const parentName = parentSlug ? (tenants.find((t) => t.slug === parentSlug)?.name ?? parentSlug) : null
  const badges = statusBadges(tenant)
  const plan = planBadge(tenant)

  function selectTab(next: TabKey) {
    const nextParams = new URLSearchParams(params)
    if (next === 'overview') nextParams.delete('tab')
    else nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
    window.scrollTo({ top: 0 })
  }

  const tabProps = {
    tenant,
    parentName,
    onParentChanged: setParentSlug,
    onOpenTab: selectTab,
    onDeleted: () => {
      handleHardDeleted(tenant.id)
      navigate('/platform/tenants')
    },
  }

  return (
    <div className="min-h-screen pb-16 text-slate-100">
      <header className="sticky top-12 z-30 border-b border-border bg-[#071229]/95 px-4 pb-0 pt-3 backdrop-blur lg:top-0 sm:px-6">
        <div className="mx-auto max-w-[1500px]">
          <nav aria-label="Breadcrumb" className="-mt-2 mb-0 flex items-center text-xs text-muted-300">
            <Link to="/platform/tenants" className="-my-1 inline-flex min-h-[44px] items-center font-semibold text-accent-sky-400 hover:text-accent-sky-500">
              All tenants
            </Link>
            <span className="mx-1.5">/</span>
            <span aria-current="page">{tenant.name}</span>
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <TenantAvatar name={tenant.name} logoUrl={tenant.logoUrl} size={44} />
              <button
                type="button"
                onClick={openSwitcher}
                title={`Switch tenant (${isMac ? '⌘K' : 'Ctrl+K'})`}
                className="min-h-[44px] min-w-0 truncate rounded-lg px-2 text-left text-xl font-black text-white hover:bg-slate-800/60 sm:text-2xl"
              >
                {tenant.name} <span className="text-base text-muted-300">▾</span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openSwitcher}
                className="min-h-[44px] rounded-lg border border-accent-sky-500/40 px-3 py-2 text-sm font-semibold text-accent-sky-400 hover:bg-accent-sky-500/10"
              >
                Switch tenant <span className="ml-1 hidden rounded border border-slate-600 px-1.5 text-xs text-muted-300 sm:inline">{isMac ? '⌘K' : 'Ctrl+K'}</span>
              </button>
              <span className="hidden items-center gap-2 md:inline-flex">
                <RefreshDisplaysButton tenant={tenant} />
                <ForcePilotUpdateButton tenant={tenant} />
              </span>
              <MoreMenu tenant={tenant} onArchive={() => setArchiveOpen(true)} />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {badges.map((badge) => (
              <StatusBadge key={badge.label} badge={badge} />
            ))}
            {plan && <StatusBadge badge={plan} />}
            {parentName && <StatusBadge badge={{ label: `Parent: ${parentName}`, tone: 'grey' }} />}
            <span className="text-xs text-muted-300">
              {tenant.subdomain} · joined {formatDate(tenant.createdAt)}
            </span>
          </div>

          <div role="tablist" aria-label="Tenant sections" className="-mx-1 mt-2 flex overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`panel-${t.key}`}
                onClick={() => selectTab(t.key)}
                className={`min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition ${
                  tab === t.key ? 'border-accent-sky-400 text-white' : 'border-transparent text-muted-300 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 pt-5 sm:px-6">
        {isArchived(tenant) && (
          <div className="mb-4 rounded-xl border border-slate-500/50 bg-slate-800/60 px-4 py-3 text-sm text-slate-100">
            Archived {tenant.deletedAt ? formatDate(tenant.deletedAt) : ''}. Their team is locked out. Permanently delete is on the Internal tab.
          </div>
        )}
        {/* key={tenant.id}: every editor below keeps local draft state, so a tenant
            switch must remount them or one tenant's draft could be saved onto
            the next. The arbitrary-variant classes lift every button, select and
            text input in the moved editors to a 44px touch target. */}
        <div
          key={tenant.id}
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="[&_button]:min-h-[44px] [&_select]:min-h-[44px] [&_input:not([type=checkbox]):not([type=file]):not([type=radio])]:min-h-[44px]"
        >
          {tab === 'overview' && <OverviewTab {...tabProps} />}
          {tab === 'billing' && <BillingTab {...tabProps} />}
          {tab === 'products' && <ProductsTab {...tabProps} />}
          {tab === 'weather' && <WeatherTab {...tabProps} />}
          {tab === 'devices' && <DevicesTab {...tabProps} />}
          {tab === 'members' && <MembersTab {...tabProps} />}
          {tab === 'internal' && <InternalTab {...tabProps} />}
        </div>
      </main>

      {archiveOpen && <ArchiveDialog tenant={tenant} onClose={() => setArchiveOpen(false)} />}
    </div>
  )
}
