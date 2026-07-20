import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_ONBOARD_TENANT_URL } from '../config/publicApi'

const TENANTS_URL = '/api/platform/tenants'

interface PlatformDisplay {
  id: number
  slug: string
  name: string
  templateId: string
  active: boolean
  entitled: boolean
  entitlementTrialExpiresAt: string | null
}

interface PlatformTenant {
  id: number
  slug: string
  name: string
  subdomain: string
  active: boolean
  weatherPublic: boolean
  opsPublic: boolean
  isInternal: boolean
  hasPhysicalAtc: boolean
  storageQuotaBytes: number
  usedBytes: number
  logoUrl: string | null
  createdAt: string
  displays: PlatformDisplay[]
}

type BooleanField = 'active' | 'weatherPublic' | 'opsPublic' | 'isInternal' | 'hasPhysicalAtc'

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function patchTenant(id: number, body: Record<string, boolean | number | string>): Promise<PlatformTenant | null> {
  const response = await fetch(`${TENANTS_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.ok ? response.json() : null
}

type DisplayPatchResult = { active: boolean; entitled: boolean; entitlementTrialExpiresAt: string | null }

async function patchDisplay(
  tenantId: number,
  displayId: number,
  body: Partial<DisplayPatchResult>
): Promise<DisplayPatchResult | null> {
  const response = await fetch(`${TENANTS_URL}/${tenantId}/displays/${displayId}`, {
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

// Same inline-edit-on-blur pattern as QuotaEditor above - a developer
// customer-service fix (e.g. a tenant's name has a typo or their logo
// was uploaded badly-sized) shouldn't need a separate "Edit" mode.
function NameEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (name: string) => void }): JSX.Element {
  const [name, setName] = useState(tenant.name)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(tenant.name)
  }, [tenant.name])

  async function commit() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === tenant.name) {
      setName(tenant.name)
      return
    }
    setSaving(true)
    const updated = await patchTenant(tenant.id, { name: trimmed })
    setSaving(false)
    if (updated) onSaved(updated.name)
    else setName(tenant.name)
  }

  return (
    <input
      value={name}
      disabled={saving}
      onChange={(event) => setName(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
      }}
      className="w-full rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm font-semibold text-white focus:border-sky-500 focus:outline-none"
    />
  )
}

// Developer-override logo upload/replace - the customer-service fallback
// for a tenant's badly-sized or wrong logo, independent of the tenant's
// own self-service branding editor (DesignPage.tsx's Branding section).
// Uses the same validateAndUploadLogo pipeline server-side (functions/
// api/_utils/logoUpload.ts), just via the platform-admin-gated route.
function LogoEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (logoUrl: string) => void }): JSX.Element {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const response = await fetch(`${TENANTS_URL}/${tenant.id}/logo`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error || 'Upload failed')
        return
      }
      if (data?.logoUrl) onSaved(data.logoUrl as string)
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-14 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900/80">
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <span className="text-[9px] text-muted-500">None</span>
        )}
      </div>
      <label className="cursor-pointer text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
        {uploading ? 'Uploading…' : 'Replace'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          onChange={handleUpload}
          disabled={uploading}
          className="hidden"
        />
      </label>
      {error && <span className="text-xs text-status-bad">{error}</span>}
    </div>
  )
}

// Per-display controls (migration 0034): `active` is Part D's generic
// force-off, shown for every display slug this tenant has. `entitled` +
// the trial-expiry date are Part C's café billing gate, shown only for
// the 'cafe-tv' slug - the only display that mechanism currently gates
// (functions/api/public/display.ts checks it by slug, not templateId).
// Same optimistic-toggle-with-revert-on-failure pattern as
// handleBooleanToggle below, scoped to one display instead of one tenant.
function DisplayControls({
  tenantId,
  display,
  onSaved,
}: {
  tenantId: number
  display: PlatformDisplay
  onSaved: (displayId: number, patch: Partial<DisplayPatchResult>) => void
}): JSX.Element {
  const [expiryInput, setExpiryInput] = useState(display.entitlementTrialExpiresAt ? display.entitlementTrialExpiresAt.slice(0, 10) : '')
  const [savingExpiry, setSavingExpiry] = useState(false)

  useEffect(() => {
    setExpiryInput(display.entitlementTrialExpiresAt ? display.entitlementTrialExpiresAt.slice(0, 10) : '')
  }, [display.entitlementTrialExpiresAt])

  async function toggleField(field: 'active' | 'entitled', next: boolean) {
    onSaved(display.id, { [field]: next })
    const updated = await patchDisplay(tenantId, display.id, { [field]: next })
    if (!updated) onSaved(display.id, { [field]: !next })
  }

  async function commitExpiry() {
    const trimmed = expiryInput.trim()
    const nextIso = trimmed ? new Date(`${trimmed}T23:59:59.999Z`).toISOString() : null
    if (nextIso === display.entitlementTrialExpiresAt) return
    setSavingExpiry(true)
    const updated = await patchDisplay(tenantId, display.id, { entitlementTrialExpiresAt: nextIso })
    setSavingExpiry(false)
    if (updated) onSaved(display.id, { entitlementTrialExpiresAt: updated.entitlementTrialExpiresAt })
    else setExpiryInput(display.entitlementTrialExpiresAt ? display.entitlementTrialExpiresAt.slice(0, 10) : '')
  }

  async function clearExpiry() {
    setExpiryInput('')
    setSavingExpiry(true)
    const updated = await patchDisplay(tenantId, display.id, { entitlementTrialExpiresAt: null })
    setSavingExpiry(false)
    if (updated) onSaved(display.id, { entitlementTrialExpiresAt: updated.entitlementTrialExpiresAt })
  }

  const isExpiredTrial = !!display.entitlementTrialExpiresAt && new Date(display.entitlementTrialExpiresAt).getTime() <= Date.now()

  return (
    <div className="mb-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1.5 last:mb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{display.slug}</span>
        <label className="flex items-center gap-1 text-[10px] text-muted-400">
          <input
            type="checkbox"
            checked={display.active}
            onChange={(event) => toggleField('active', event.target.checked)}
            className="h-3.5 w-3.5"
          />
          active
        </label>
      </div>
      {display.slug === 'cafe-tv' && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-1.5">
          <label className="flex items-center gap-1 text-[10px] text-muted-400">
            <input
              type="checkbox"
              checked={display.entitled}
              onChange={(event) => toggleField('entitled', event.target.checked)}
              className="h-3.5 w-3.5"
            />
            entitled
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-500">trial ends</span>
            <input
              type="date"
              value={expiryInput}
              disabled={savingExpiry}
              onChange={(event) => setExpiryInput(event.target.value)}
              onBlur={commitExpiry}
              className="rounded border border-slate-700 bg-slate-900/80 px-1 py-0.5 text-[10px] text-white focus:border-sky-500 focus:outline-none"
            />
            {display.entitlementTrialExpiresAt && (
              <button type="button" onClick={clearExpiry} className="text-[10px] text-slate-500 hover:text-slate-300">
                clear
              </button>
            )}
          </div>
          {isExpiredTrial && <span className="text-[10px] font-bold text-status-bad">expired</span>}
        </div>
      )}
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

  function handleNameSaved(tenantId: number, name: string) {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, name } : t)))
  }

  function handleLogoSaved(tenantId: number, logoUrl: string) {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, logoUrl } : t)))
  }

  function handleDisplaySaved(tenantId: number, displayId: number, patch: Partial<DisplayPatchResult>) {
    setTenants((prev) =>
      prev.map((t) =>
        t.id === tenantId
          ? { ...t, displays: t.displays.map((display) => (display.id === displayId ? { ...display, ...patch } : display)) }
          : t
      )
    )
  }

  const [onboarding, setOnboarding] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; slug: string } | null>(null)
  const [onboardError, setOnboardError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleOnboardTenant() {
    setOnboarding(true)
    setOnboardError(null)
    setInviteResult(null)
    try {
      const response = await fetch(PLATFORM_ONBOARD_TENANT_URL, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setOnboardError(data?.error || 'Failed to onboard a new tenant')
        return
      }
      setInviteResult({ inviteUrl: data.inviteUrl, slug: data.slug })
      // Refresh the list so the new tenant row appears immediately,
      // reusing the exact same fetch the initial mount already does.
      const refreshed = await fetch(TENANTS_URL)
      const refreshedData = refreshed.ok ? await refreshed.json() : null
      if (refreshedData) setTenants(refreshedData.tenants ?? [])
    } finally {
      setOnboarding(false)
    }
  }

  async function handleCopyInviteLink() {
    if (!inviteResult) return
    await navigator.clipboard.writeText(inviteResult.inviteUrl).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
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
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-black uppercase tracking-wide text-primary">Platform · Tenants</h1>
          <div className="flex items-center gap-3">
            <Link to="/platform/onboarding-content" className="text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
              Edit onboarding content →
            </Link>
            <button
              type="button"
              onClick={handleOnboardTenant}
              disabled={onboarding}
              className="rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {onboarding ? 'Creating…' : 'Onboard new tenant'}
            </button>
          </div>
        </div>
        <p className="mb-4 max-w-2xl text-sm text-muted-400">
          Every tenant, across every organization. Developer-only — controls pause/resume, cross-tenant public
          visibility, internal/template status, storage quota, and per-display active/café-entitlement state for
          any tenant, regardless of which org you're currently switched to.
        </p>

        {onboardError && <p className="mb-4 text-sm font-semibold text-status-bad">{onboardError}</p>}

        {inviteResult && (
          <div className="mb-8 rounded-2xl border border-accent-sky-500/40 bg-panel p-6">
            <div className="mb-2 text-sm font-bold uppercase tracking-widest text-accent-sky-400">
              New tenant created: {inviteResult.slug}
            </div>
            <p className="mb-3 text-xs text-muted-500">
              Copy this single-use link and send it to the customer manually — no email is sent automatically yet.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteResult.inviteUrl}
                onFocus={(event) => event.target.select()}
                className="flex-1 rounded border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="shrink-0 rounded bg-accent-sky-500 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-accent-sky-400"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-400">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-semibold uppercase tracking-widest text-muted-400">
                  <th className="px-4 py-3">Tenant</th>
                  <th className="px-4 py-3">Logo</th>
                  <th className="px-4 py-3">Subdomain</th>
                  <th className="px-4 py-3 text-center">Active</th>
                  <th className="px-4 py-3 text-center">Weather public</th>
                  <th className="px-4 py-3 text-center">Ops public</th>
                  <th className="px-4 py-3 text-center">Internal</th>
                  <th className="px-4 py-3 text-center">Has ATC</th>
                  <th className="px-4 py-3">Displays</th>
                  <th className="px-4 py-3">Storage</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <NameEditor tenant={tenant} onSaved={(name) => handleNameSaved(tenant.id, name)} />
                      <div className="mt-1 text-xs text-muted-500">{tenant.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <LogoEditor tenant={tenant} onSaved={(logoUrl) => handleLogoSaved(tenant.id, logoUrl)} />
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
                      <BooleanToggle
                        checked={tenant.hasPhysicalAtc}
                        onChange={(next) => handleBooleanToggle(tenant, 'hasPhysicalAtc', next)}
                        label={`${tenant.slug} has physical ATC`}
                      />
                    </td>
                    <td className="min-w-[200px] px-4 py-3">
                      {tenant.displays.length === 0 ? (
                        <span className="text-xs text-muted-500">No displays yet</span>
                      ) : (
                        tenant.displays.map((display) => (
                          <DisplayControls
                            key={display.id}
                            tenantId={tenant.id}
                            display={display}
                            onSaved={(displayId, patch) => handleDisplaySaved(tenant.id, displayId, patch)}
                          />
                        ))
                      )}
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
