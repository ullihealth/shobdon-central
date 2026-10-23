import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTenants } from '../components/platform/tenants/TenantsContext'
import { usePlatformTenantsOutlet } from './PlatformTenantsPage'
import { NewSignupsBadge, formatDate } from '../components/platform/tenants/tenantEditors'
import OnboardTenantPanel from '../components/platform/tenants/OnboardTenantPanel'
import { PiStateText, StatusBadge, TenantAvatar } from '../components/platform/tenants/TenantUi'
import {
  FILTERS,
  filterCounts,
  matchesFilter,
  matchesSearch,
  piState,
  piUnitsForTenant,
  planBadge,
  rememberRecentTenant,
  statusBadges,
  type FilterKey,
} from '../components/platform/tenants/tenantStatus'

type SortOrder = 'name-asc' | 'date-desc' | 'date-asc'

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

// /platform/tenants - every tenant in one searchable table. Opening a row goes
// to /platform/tenants/:slug. The page-level platform actions that used to sit
// above the old two-pane layout stay here, unchanged.
export default function PlatformTenantsListPage(): JSX.Element {
  const {
    tenants,
    loading,
    piUnits,
    now,
    refreshTenants,
    refreshAllStatus,
    handleRefreshAllDisplays,
    forcePilotAllStatus,
    handleForcePilotUpdateAll,
  } = useTenants()
  const { openSwitcher } = usePlatformTenantsOutlet()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')
  const [onboardOpen, setOnboardOpen] = useState(false)

  // Role-aware title link, same lookup/mapping Header.tsx already uses for its
  // own title-click behaviour (/api/tenant/me -> role -> landing page).
  const [dashboardLandingPage, setDashboardLandingPage] = useState('/config')
  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const role = data?.role
        setDashboardLandingPage(
          role === 'atc'
            ? '/atc-control'
            : role === 'media'
              ? '/media-manager'
              : role === 'cafe'
                ? '/cafe-media'
                : data?.tenantType === 'venue_cafe'
                  ? '/cafe-media'
                  : '/config'
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const counts = useMemo(() => filterCounts(tenants, piUnits, now), [tenants, piUnits, now])

  const rows = useMemo(() => {
    const copy = tenants.filter(
      (t) => matchesFilter(t, filter, piUnits, now) && matchesSearch(t, query, piUnitsForTenant(piUnits, t.id))
    )
    if (sortOrder === 'name-asc') copy.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortOrder === 'date-desc') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return copy
  }, [tenants, filter, query, sortOrder, piUnits, now])

  function openTenant(slug: string) {
    rememberRecentTenant(slug)
    navigate(`/platform/tenants/${slug}`)
  }

  const actionButton =
    'min-h-[44px] rounded-lg border border-accent-sky-500/40 px-3 py-2 text-sm font-semibold text-accent-sky-400 transition hover:bg-accent-sky-500/10 disabled:opacity-60'

  return (
    <div className="min-h-screen px-4 pb-16 pt-6 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[32px] font-bold leading-tight text-primary">
            <Link to={dashboardLandingPage} className="[font-size:inherit] transition-colors hover:text-accent-sky-400" title="Back to Dashboard">
              Platform · Tenants
            </Link>
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <NewSignupsBadge />
            <button type="button" onClick={handleRefreshAllDisplays} disabled={refreshAllStatus === 'loading'} className={actionButton}>
              {refreshAllStatus === 'loading'
                ? 'Refreshing all…'
                : refreshAllStatus === 'success'
                  ? 'Refreshed all ✓'
                  : refreshAllStatus === 'error'
                    ? 'Failed - retry'
                    : 'Refresh all tenant displays'}
            </button>
            <button type="button" onClick={handleForcePilotUpdateAll} disabled={forcePilotAllStatus === 'loading'} className={actionButton}>
              {forcePilotAllStatus === 'loading'
                ? 'Forcing all…'
                : forcePilotAllStatus === 'success'
                  ? 'Update forced for all ✓'
                  : forcePilotAllStatus === 'error'
                    ? 'Failed - retry'
                    : 'Force Pilot App update (all tenants)'}
            </button>
            <Link
              to="/platform/onboarding-content"
              className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500"
            >
              Edit onboarding content →
            </Link>
            <button
              type="button"
              onClick={() => setOnboardOpen((open) => !open)}
              aria-expanded={onboardOpen}
              className="min-h-[44px] rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-accent-sky-400"
            >
              {onboardOpen ? 'Close onboarding form' : 'Onboard new tenant'}
            </button>
          </div>
        </div>

        {onboardOpen && (
          <OnboardTenantPanel
            tenants={tenants}
            onCreated={async () => {
              await refreshTenants()
            }}
          />
        )}

        <p className="mb-4 max-w-3xl text-sm text-muted-400">
          Every tenant, across every organization. Developer-only. Open a tenant to control suspend/resume, archive,
          billing, products, weather, displays, members and internal settings, regardless of which org you are currently
          switched to.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, slug, member email or Pi box ID"
              aria-label="Search tenants"
              className="min-h-[44px] w-full rounded-lg border border-slate-700 bg-slate-900/80 py-2 pl-3 pr-20 text-sm text-white placeholder:text-muted-400 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={openSwitcher}
              title="Open the quick tenant switcher"
              className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-600 px-2 py-1 text-xs font-semibold text-muted-300 hover:border-slate-400 sm:block"
            >
              {isMac ? '⌘K' : 'Ctrl+K'}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-300">
            <span className="sr-only sm:not-sr-only">Sort</span>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
              className="min-h-[44px] rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            >
              <option value="name-asc">Name A-Z</option>
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
            </select>
          </label>
        </div>

        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter tenants">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`min-h-[44px] rounded-full border px-4 py-2 text-sm font-semibold transition ${
                filter === f.key
                  ? 'border-accent-sky-500 bg-accent-sky-500/15 text-white'
                  : 'border-slate-700 text-muted-300 hover:border-slate-500'
              }`}
            >
              {f.label} <span className="ml-1 text-muted-400">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border text-[14px] font-semibold text-muted-300">
                <tr>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Tenant</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Plan</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Media box</th>
                  <th scope="col" className="px-4 py-3.5 text-right font-semibold">Members</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-[16px] text-muted-400">
                      No tenants match.
                    </td>
                  </tr>
                )}
                {rows.map((tenant) => {
                  const units = piUnitsForTenant(piUnits, tenant.id)
                  const plan = planBadge(tenant)
                  return (
                    <tr
                      key={tenant.id}
                      onClick={() => openTenant(tenant.slug)}
                      className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/platform/tenants/${tenant.slug}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            rememberRecentTenant(tenant.slug)
                          }}
                          className="flex min-h-[48px] items-center gap-3"
                        >
                          <TenantAvatar name={tenant.name} logoUrl={tenant.logoUrl} />
                          <span className="min-w-0">
                            <span className="block text-[16px] font-semibold text-white">{tenant.name}</span>
                            <span className="block text-[15px] text-muted-400">{tenant.slug}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1">
                          {statusBadges(tenant).map((badge) => (
                            <StatusBadge key={badge.label} badge={badge} />
                          ))}
                        </span>
                      </td>
                      <td className="px-4 py-3">{plan ? <StatusBadge badge={plan} /> : <span className="text-muted-400">None</span>}</td>
                      <td className="px-4 py-3">
                        {tenant.mediaBoxIdentifier || units.length > 0 ? (
                          <span className="flex max-w-[180px] flex-col gap-0.5">
                            <span className="break-all text-[16px] font-medium text-slate-50">
                              {tenant.mediaBoxIdentifier || units.map((u) => u.serialNumber).join(', ')}
                            </span>
                            {units.length > 0 && <PiStateText state={piState(units[0], now)} />}
                          </span>
                        ) : (
                          <span className="text-muted-400">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[16px] font-medium tabular-nums">{tenant.members.length}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[16px] text-muted-300">{formatDate(tenant.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
