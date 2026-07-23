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

interface PlatformMember {
  id: string
  email: string
  name: string
  role: string
  createdAt: string
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
  members: PlatformMember[]
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

// A settings-list row - visible text label + BooleanToggle, replacing
// the old table's column-header-as-label convention now that these
// live in the detail pane's stacked sections instead of table cells.
function SettingsToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 last:border-0">
      <span className="text-sm text-muted-300">{label}</span>
      <BooleanToggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

// Members list for the selected tenant's detail pane - same row shape/
// styling as MembersPage.tsx's own "Current members" rows (email, role,
// joined date, action buttons), reused here for a familiar look rather
// than inventing a second member-row style. Actions are deliberately
// display-only for now (not wired to real remove/reset endpoints) - per
// this round's own scope, this just reserves the layout slot so a real
// action can be wired in later without another rework. disabled + a
// title tooltip communicates "not available here yet" rather than the
// button silently doing nothing on click.
function MemberRow({ member }: { member: PlatformMember }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-white">{member.email}</div>
        <div className="text-xs text-muted-500">
          {member.role} · joined {formatDate(member.createdAt)}
        </div>
      </div>
      {member.role !== 'owner' && (
        <div className="flex gap-3">
          <button
            type="button"
            disabled
            title="Not available from here yet"
            className="cursor-not-allowed text-xs font-semibold text-accent-sky-400 opacity-40"
          >
            Reset password
          </button>
          <button type="button" disabled title="Not available from here yet" className="cursor-not-allowed text-xs font-semibold text-status-bad opacity-40">
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

export default function PlatformTenantsPage(): JSX.Element {
  const [tenants, setTenants] = useState<PlatformTenant[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  // Role-aware title link, same lookup/mapping Header.tsx already uses for
  // its own title-click behaviour (/api/tenant/me -> role -> landing
  // page), reused here rather than inventing a second convention. This
  // page is cross-tenant/org-independent (requirePlatformAdmin, not
  // requireTenant - see this file's own top-of-file comment), so "back to
  // dashboard" can only ever mean "wherever /api/tenant/me resolves for
  // whichever org this developer's session/switcher currently points at" -
  // there's no single tenant this page is scoped to. Defaults to '/config'
  // (the owner/admin landing page) rather than Header's own '/login'
  // default, since reaching this page at all already requires a real
  // logged-in developer session - '/login' would only ever flash briefly
  // before the fetch resolves, same as everywhere else this pattern is used.
  const [dashboardLandingPage, setDashboardLandingPage] = useState('/config')
  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const role = data?.role
        setDashboardLandingPage(role === 'atc' ? '/atc-control' : role === 'media' ? '/media-manager' : '/config')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Left-pane selection, CRM-style - null until the first successful
  // fetch resolves, at which point the effect below auto-selects the
  // first tenant (a short list, 5 today, so an initially-empty detail
  // pane would just read as broken rather than an intentional "pick
  // one" state; MediaLibraryPage.tsx's own null-until-clicked precedent
  // suits a much longer, unbounded file list better than it suits this).
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null)

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
        if (data) {
          const loaded: PlatformTenant[] = data.tenants ?? []
          setTenants(loaded)
          setSelectedTenantId((prev) => prev ?? loaded[0]?.id ?? null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null

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
      {/* max-w-[1900px], not max-w-6xl (1152px, far too narrow once the
          right-hand detail pane's settings/displays/members sections are
          all open at once) - reusing DesignPage.tsx's own exact
          max-w-[1900px] value/pattern rather than a rem-based class like
          max-w-7xl. This codebase's root font-size is clamp(12px, 1.5vmin,
          20px) (index.css), so a rem-based container cap scales with
          viewport *height*, not just width - MediaLibraryPage.tsx already
          documents this same rem-scaling behaviour by name, and this page
          previously confirmed it via Playwright when it was still a
          table (see git history) - unchanged now that it's a two-pane
          layout, since the underlying font-size behaviour is unaffected
          by that rewrite. */}
      <div className="mx-auto max-w-[1900px]">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-black uppercase tracking-wide text-primary">
            <Link to={dashboardLandingPage} className="transition-colors hover:text-accent-sky-400" title="Back to Dashboard">
              Platform · Tenants
            </Link>
          </h1>
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
          // CRM-style two-pane layout, mirroring MediaLibraryPage.tsx's
          // own list+detail interaction convention (selected-id state,
          // a row class keyed off it, a conditionally-rendered detail
          // panel) rather than inventing a second one. Fixed-width left
          // pane (w-72, same fixed-width idiom as that file's own
          // FileInspector) + flex-1 right pane, min-h so a short tenant
          // list doesn't collapse the detail pane's vertical rhythm.
          <div className="flex min-h-[600px] flex-col gap-4 lg:flex-row">
            <div className="flex max-h-[75vh] w-full shrink-0 flex-col gap-1 overflow-y-auto rounded-2xl border border-border bg-panel p-2 lg:w-72">
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => setSelectedTenantId(tenant.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                    tenant.id === selectedTenantId
                      ? 'border-accent-sky-500 bg-accent-sky-500/10 font-semibold text-white'
                      : 'border-transparent text-muted-300 hover:bg-slate-800/60'
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${tenant.active ? 'bg-status-good' : 'bg-status-bad'}`}
                    title={tenant.active ? 'Active' : 'Paused'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{tenant.name}</span>
                    <span className="block truncate text-xs text-muted-500">{tenant.slug}</span>
                  </span>
                </button>
              ))}
            </div>

            {selectedTenant && (
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <section className="rounded-2xl border border-border bg-panel p-5">
                  <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Tenant settings</div>
                  <div className="mb-4 flex flex-wrap items-start gap-4">
                    <div className="min-w-[220px] flex-1">
                      <NameEditor tenant={selectedTenant} onSaved={(name) => handleNameSaved(selectedTenant.id, name)} />
                      <div className="mt-1 text-xs text-muted-500">
                        {selectedTenant.subdomain} · created {formatDate(selectedTenant.createdAt)}
                      </div>
                    </div>
                    <LogoEditor tenant={selectedTenant} onSaved={(logoUrl) => handleLogoSaved(selectedTenant.id, logoUrl)} />
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border/60">
                    <SettingsToggleRow
                      label="Active"
                      checked={selectedTenant.active}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'active', next)}
                    />
                    <SettingsToggleRow
                      label="Weather public"
                      checked={selectedTenant.weatherPublic}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'weatherPublic', next)}
                    />
                    <SettingsToggleRow
                      label="Ops public"
                      checked={selectedTenant.opsPublic}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'opsPublic', next)}
                    />
                    <SettingsToggleRow
                      label="Internal"
                      checked={selectedTenant.isInternal}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'isInternal', next)}
                    />
                    <SettingsToggleRow
                      label="Has physical ATC"
                      checked={selectedTenant.hasPhysicalAtc}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'hasPhysicalAtc', next)}
                    />
                  </div>
                  <div className="mt-4">
                    <QuotaEditor tenant={selectedTenant} onSaved={(bytes) => handleQuotaSaved(selectedTenant.id, bytes)} />
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-panel p-5">
                  <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Displays</div>
                  {selectedTenant.displays.length === 0 ? (
                    <span className="text-xs text-muted-500">No displays yet</span>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selectedTenant.displays.map((display) => (
                        <DisplayControls
                          key={display.id}
                          tenantId={selectedTenant.id}
                          display={display}
                          onSaved={(displayId, patch) => handleDisplaySaved(selectedTenant.id, displayId, patch)}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-border bg-panel p-5">
                  <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Members</div>
                  {selectedTenant.members.length === 0 ? (
                    <span className="text-xs text-muted-500">No members yet</span>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {selectedTenant.members.map((member) => (
                        <MemberRow key={member.id} member={member} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
