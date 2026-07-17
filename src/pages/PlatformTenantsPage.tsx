import { useEffect, useState } from 'react'

const TENANTS_URL = '/api/platform/tenants'

interface PlatformTenant {
  id: number
  slug: string
  name: string
  subdomain: string
  active: boolean
  weatherPublic: boolean
  opsPublic: boolean
  isInternal: boolean
  storageQuotaBytes: number
  usedBytes: number
  createdAt: string
}

type BooleanField = 'active' | 'weatherPublic' | 'opsPublic' | 'isInternal'

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function patchTenant(id: number, body: Record<string, boolean | number>): Promise<PlatformTenant | null> {
  const response = await fetch(`${TENANTS_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.ok ? response.json() : null
}

// Editable inline, saved on blur/Enter (not a separate "Edit" mode) -
// matches how quickly the other toggles on this row apply, so a quota
// change doesn't feel like a heavier action than flipping a checkbox.
function QuotaEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (bytes: number) => void }): JSX.Element {
  const [mb, setMb] = useState(String(Math.round(tenant.storageQuotaBytes / (1024 * 1024))))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMb(String(Math.round(tenant.storageQuotaBytes / (1024 * 1024))))
  }, [tenant.storageQuotaBytes])

  async function commit() {
    const parsedMb = Number(mb)
    const bytes = Math.round(parsedMb * 1024 * 1024)
    if (!Number.isFinite(parsedMb) || parsedMb <= 0 || bytes === tenant.storageQuotaBytes) {
      setMb(String(Math.round(tenant.storageQuotaBytes / (1024 * 1024))))
      return
    }
    setSaving(true)
    const updated = await patchTenant(tenant.id, { storageQuotaBytes: bytes })
    setSaving(false)
    if (updated) onSaved(updated.storageQuotaBytes)
  }

  const pct = Math.min(100, (tenant.usedBytes / tenant.storageQuotaBytes) * 100)

  return (
    <div className="min-w-[140px]">
      <div className="flex items-center gap-1 text-xs text-muted-400">
        <span>{formatMb(tenant.usedBytes)} /</span>
        <input
          type="number"
          min={1}
          value={mb}
          disabled={saving}
          onChange={(event) => setMb(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
          className="w-16 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-right text-xs text-white focus:border-sky-500 focus:outline-none"
        />
        <span>MB</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-accent-sky-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BooleanToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}): JSX.Element {
  return (
    <label className="flex items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
        className="h-4 w-4"
      />
    </label>
  )
}

export default function PlatformTenantsPage(): JSX.Element {
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

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

  function handleBooleanToggle(tenant: PlatformTenant, field: BooleanField, next: boolean) {
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, [field]: next } : t)))
    patchTenant(tenant.id, { [field]: next }).then((updated) => {
      if (!updated) {
        // Revert on failure - an optimistic toggle that silently didn't
        // persist would be worse than a visible failure, since this page
        // controls whether a tenant's public dashboard is even reachable.
        setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, [field]: !next } : t)))
      }
    })
  }

  function handleQuotaSaved(tenantId: number, bytes: number) {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, storageQuotaBytes: bytes } : t)))
  }

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
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-6 pb-16 pt-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Platform · Tenants</h1>
        <p className="mb-8 max-w-2xl text-sm text-muted-400">
          Every tenant, across every organization. Developer-only — controls pause/resume, cross-tenant public
          visibility, internal/template status, and storage quota for any tenant, regardless of which org you're
          currently switched to.
        </p>

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Subdomain</th>
                  <th className="px-4 py-3 text-center">Active</th>
                  <th className="px-4 py-3 text-center">Weather public</th>
                  <th className="px-4 py-3 text-center">Ops public</th>
                  <th className="px-4 py-3 text-center">Internal</th>
                  <th className="px-4 py-3">Storage</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-white">{tenant.name}</div>
                      <div className="text-xs text-muted-500">{tenant.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-400">{tenant.subdomain}</td>
                    <td className="px-4 py-3">
                      <BooleanToggle
                        checked={tenant.active}
                        onChange={(next) => handleBooleanToggle(tenant, 'active', next)}
                        label={`${tenant.slug} active`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <BooleanToggle
                        checked={tenant.weatherPublic}
                        onChange={(next) => handleBooleanToggle(tenant, 'weatherPublic', next)}
                        label={`${tenant.slug} weather public`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <BooleanToggle
                        checked={tenant.opsPublic}
                        onChange={(next) => handleBooleanToggle(tenant, 'opsPublic', next)}
                        label={`${tenant.slug} ops public`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <BooleanToggle
                        checked={tenant.isInternal}
                        onChange={(next) => handleBooleanToggle(tenant, 'isInternal', next)}
                        label={`${tenant.slug} internal`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <QuotaEditor tenant={tenant} onSaved={(bytes) => handleQuotaSaved(tenant.id, bytes)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-400">{formatDate(tenant.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
