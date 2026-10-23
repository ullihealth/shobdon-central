import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  TENANTS_URL,
  patchTenant,
  triggerForcePilotUpdate,
  triggerRefreshDisplays,
  type BooleanField,
  type DisplayPatchResult,
  type PlatformTenant,
  type RefreshDisplaysStatus,
} from './tenantEditors'
import type { PiUnitSummary } from './tenantStatus'

// Shared data and handlers for the Platform Tenants list and tenant pages.
// The handlers are the old single-page component's own, moved here
// unchanged (same requests, same optimistic update and revert-on-failure),
// so the list, the tenant page and the quick switcher all see one copy of
// the tenant data and a tenant switch never refetches or loses state.
export interface TenantsStore {
  tenants: PlatformTenant[]
  loading: boolean
  forbidden: boolean
  piUnits: PiUnitSummary[]
  now: number
  refreshTenants: () => Promise<void>
  handleBooleanToggle: (tenant: PlatformTenant, field: BooleanField, next: boolean) => Promise<boolean>
  handleQuotaSaved: (tenantId: number, bytes: number) => void
  handleCarouselBudgetSaved: (tenantId: number, seconds: number) => void
  handleAfisoFrequencySaved: (tenantId: number, frequency: string) => void
  handleQnhQfeOffsetSaved: (tenantId: number, offset: number | null) => void
  handleNameSaved: (tenantId: number, name: string) => void
  handleLogoSaved: (tenantId: number, logoUrl: string) => void
  handleMediaBoxFieldsSaved: (
    tenantId: number,
    fields: { mediaBoxIdentifier: string | null; mediaBoxIssuedDate: string | null; mediaBoxReturnedDate: string | null }
  ) => void
  handleQrTargetUrlSaved: (tenantId: number, qrTargetUrl: string) => void
  handleQrCaptionTextSaved: (tenantId: number, qrCaptionText: string) => void
  handleQrMockupSaved: (tenantId: number, qrMockupImageUrl: string) => void
  handleDisplaySaved: (tenantId: number, displayId: number, patch: Partial<DisplayPatchResult>) => void
  handleSuspendToggle: (tenant: PlatformTenant) => void
  handleArchiveTenant: (tenant: PlatformTenant) => Promise<boolean>
  handleHardDeleted: (tenantId: number) => void
  refreshAllStatus: RefreshDisplaysStatus
  handleRefreshAllDisplays: () => Promise<void>
  forcePilotAllStatus: RefreshDisplaysStatus
  handleForcePilotUpdateAll: () => Promise<void>
}

const TenantsContext = createContext<TenantsStore | null>(null)

export function useTenants(): TenantsStore {
  const store = useContext(TenantsContext)
  if (!store) throw new Error('useTenants must be used inside TenantsProvider')
  return store
}

export function TenantsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [piUnits, setPiUnits] = useState<PiUnitSummary[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    fetch(TENANTS_URL)
      .then((response) => {
        if (response.status === 403 || response.status === 401) {
          setForbidden(true)
          return null
        }
        return response.ok ? response.json() : null
      })
      .then((data) => {
        if (data) setTenants(data.tenants ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  // Existing endpoint (the Pi Fleet inventory), read once for the Media box
  // column, the Pi box search and the offline check. A failure just means no
  // box information is shown.
  useEffect(() => {
    let cancelled = false
    fetch('/api/platform/pi-units')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.units) setPiUnits(data.units)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Keeps online/offline text honest while the page stays open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const patchOne = useCallback((tenantId: number, patch: Partial<PlatformTenant>) => {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, ...patch } : t)))
  }, [])

  const handleBooleanToggle = useCallback(async (tenant: PlatformTenant, field: BooleanField, next: boolean): Promise<boolean> => {
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, [field]: next } : t)))
    const updated = await patchTenant(tenant.id, { [field]: next })
    if (!updated) {
      // Revert on failure - an optimistic toggle that silently didn't
      // persist would be worse than a visible failure, since this page
      // controls whether a tenant's public dashboard is even reachable.
      setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, [field]: !next } : t)))
    }
    return !!updated
  }, [])

  // Full refetch, not a targeted local patch - subscription saves and member
  // add/remove/reset are simplest to re-read from source.
  const refreshTenants = useCallback(async () => {
    const response = await fetch(TENANTS_URL)
    const data = response.ok ? await response.json() : null
    if (data) setTenants(data.tenants ?? [])
  }, [])

  function handleSuspendToggle(tenant: PlatformTenant) {
    const next = !tenant.active
    const message = next
      ? `Resume ${tenant.name}? Their public dashboard becomes reachable again and their team's admin access is restored immediately.`
      : `Suspend ${tenant.name}? Their public dashboard stops resolving immediately, and their own team can log in only to manage their account and pay - everything else in their admin area is locked until you Resume. Everyone on their team is also signed out right now (open tabs go to the login page).`
    if (!window.confirm(message)) return
    void handleBooleanToggle(tenant, 'active', next)
  }

  // Archiving is a LOCAL patch, deliberately not a refetch: GET
  // /platform/tenants excludes archived rows, and a refetch would remove this
  // tenant and with it the only route to the Permanently delete panel. The
  // confirmation (typing the tenant's name) is now collected by the caller.
  async function handleArchiveTenant(tenant: PlatformTenant): Promise<boolean> {
    const updated = await patchTenant(tenant.id, { archived: true })
    if (!updated) return false
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, active: false, deletedAt: updated.deletedAt } : t)))
    return true
  }

  function handleHardDeleted(tenantId: number) {
    setTenants((prev) => prev.filter((t) => t.id !== tenantId))
  }

  const [refreshAllStatus, setRefreshAllStatus] = useState<RefreshDisplaysStatus>('idle')
  async function handleRefreshAllDisplays() {
    // ~30 seconds, not ~15 - see DesignPage.tsx's own comment on this
    // exact correction (measured twice on real Pi hardware).
    const message =
      'Refresh every tenant’s live displays now? Every dashboard currently open, across every airfield, will reload within about 30 seconds.'
    if (!window.confirm(message)) return
    setRefreshAllStatus('loading')
    const ok = await triggerRefreshDisplays('all')
    setRefreshAllStatus(ok ? 'success' : 'error')
  }

  const [forcePilotAllStatus, setForcePilotAllStatus] = useState<RefreshDisplaysStatus>('idle')
  async function handleForcePilotUpdateAll() {
    const message =
      'Force every tenant’s open Pilot’s Apps to update now? Each open app (on the latest code) will show “Updating to the latest version…” and reload within about a minute.'
    if (!window.confirm(message)) return
    setForcePilotAllStatus('loading')
    const ok = await triggerForcePilotUpdate('all')
    setForcePilotAllStatus(ok ? 'success' : 'error')
  }

  const store: TenantsStore = useMemo(
    () => ({
      tenants,
      loading,
      forbidden,
      piUnits,
      now,
      refreshTenants,
      handleBooleanToggle,
      handleQuotaSaved: (tenantId, bytes) => patchOne(tenantId, { storageQuotaBytes: bytes }),
      handleCarouselBudgetSaved: (tenantId, seconds) => patchOne(tenantId, { carouselBudgetSeconds: seconds }),
      handleAfisoFrequencySaved: (tenantId, frequency) => patchOne(tenantId, { afisoFrequency: frequency }),
      handleQnhQfeOffsetSaved: (tenantId, offset) => patchOne(tenantId, { qnhQfeOffsetHpa: offset }),
      handleNameSaved: (tenantId, name) => patchOne(tenantId, { name }),
      handleLogoSaved: (tenantId, logoUrl) => patchOne(tenantId, { logoUrl }),
      handleMediaBoxFieldsSaved: (tenantId, fields) => patchOne(tenantId, fields),
      handleQrTargetUrlSaved: (tenantId, qrTargetUrl) => patchOne(tenantId, { qrTargetUrl }),
      handleQrCaptionTextSaved: (tenantId, qrCaptionText) => patchOne(tenantId, { qrCaptionText }),
      handleQrMockupSaved: (tenantId, qrMockupImageUrl) => patchOne(tenantId, { qrMockupImageUrl }),
      handleDisplaySaved: (tenantId, displayId, patch) =>
        setTenants((prev) =>
          prev.map((t) =>
            t.id === tenantId
              ? { ...t, displays: t.displays.map((display) => (display.id === displayId ? { ...display, ...patch } : display)) }
              : t
          )
        ),
      handleSuspendToggle,
      handleArchiveTenant,
      handleHardDeleted,
      refreshAllStatus,
      handleRefreshAllDisplays,
      forcePilotAllStatus,
      handleForcePilotUpdateAll,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenants, loading, forbidden, piUnits, now, refreshAllStatus, forcePilotAllStatus]
  )

  return <TenantsContext.Provider value={store}>{children}</TenantsContext.Provider>
}
