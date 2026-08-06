import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { PLATFORM_CHECK_SLUG_URL, PLATFORM_ONBOARD_TENANT_URL } from '../config/publicApi'
import type { MemberRole } from '../types/member'
import PilotTickerSlotsEditor from '../components/platform/PilotTickerSlotsEditor'

const TENANTS_URL = '/api/platform/tenants'

// Client-side mirror of functions/api/_utils/tenantSlug.ts's own
// SLUG_FORMAT - instant typo feedback without a network round-trip.
// Reserved-word/actual-availability checking still goes through
// PLATFORM_CHECK_SLUG_URL (debounced below) rather than a second copy
// of the reserved list here - that's a single source of truth question,
// this is just "does this look like a DNS label at all."
const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const SLUG_CHECK_DEBOUNCE_MS = 400

// 'owner' deliberately excluded - not addable via this flow, same as
// MembersPage.tsx's own ADDABLE_ROLES (owner is set once at tenant
// creation, never added later). Kept in sync with that file's list and
// functions/api/platform/tenants/[id]/members/index.ts's own server-side
// allowlist - 'cafe' added to all three together this round.
const PLATFORM_ADDABLE_ROLES: MemberRole[] = ['admin', 'atc', 'media', 'cafe']

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

// Migration 0043 - keep in sync with SUBSCRIPTION_STATUSES in
// functions/api/platform/tenants/[id].ts (that file is the source of
// truth/validation; this is just the matching client-side option list).
type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'comped'
const SUBSCRIPTION_STATUS_OPTIONS: { value: SubscriptionStatus; label: string }[] = [
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past due' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'comped', label: 'Comped' },
]

interface SubscriptionHistoryEntry {
  id: number
  status: string
  note: string
  changedByEmail: string | null
  changedAt: string
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
  // Reserved Owner Slots & Time Budget round (migration 0064) -
  // carouselBudgetEnabled is the per-tenant feature toggle (manual
  // admin-only this round, no Stripe wiring yet); carouselBudgetSeconds
  // is the shared time budget the 9 tenant-controlled carousel slots
  // divide between them.
  carouselBudgetSeconds: number
  carouselBudgetEnabled: boolean
  // /global "Show live dashboard link" toggle (migration 0065) -
  // independent of weatherPublic/opsPublic, which control whether the
  // tenant is listed on /global at all; this only controls whether the
  // "View live dashboard" link renders on that already-listed card.
  globalLinkEnabled: boolean
  // Pilot View round (migration 0070) - manual AFISO status, no live
  // data source exists anywhere for this. afisoFrequency stays free
  // text (see that migration's own comment on why).
  afisoOpen: boolean
  afisoFrequency: string
  // Mobile access gating round (migration 0071) - gates the /pilot route
  // (PilotViewPage.tsx shows a locked-state screen when false). Testing-
  // phase only right now, every existing tenant was backfilled to true -
  // see that migration's own comment. mobile_free_until is a placeholder
  // column for future Stripe billing, deliberately not surfaced here -
  // no UI/route wiring for it yet.
  mobileEnabled: boolean
  // Consistent QNH/QFE rounding round (migration 0074) - null (every
  // tenant's default) means "no known fixed offset, round QNH/QFE
  // independently"; a number means "this tenant's QNH and QFE always
  // differ by exactly this many hPa in reality" (11 for Shobdon).
  // Editable via QnhQfeOffsetEditor below. Read from the EFFECTIVE
  // tenant server-side (publicConfig.ts) - editing this on a tenant
  // that's linked to a parent has no visible effect while the link
  // exists, since the parent's own value wins.
  qnhQfeOffsetHpa: number | null
  usedBytes: number
  logoUrl: string | null
  createdAt: string
  displays: PlatformDisplay[]
  members: PlatformMember[]
  subscriptionStatus: SubscriptionStatus
  subscriptionNotes: string
  subscriptionHistory: SubscriptionHistoryEntry[]
  // Migration 0044 - deliberately absent from GET /platform/tenants's own
  // response (every tenant that endpoint returns already has deleted_at
  // IS NULL by construction, so there'd be nothing to carry), only ever
  // populated client-side via handleArchiveTenant's own local patch
  // after a successful archive. Undefined (the GET-response case) and
  // null are both treated as "not archived" everywhere this is read.
  deletedAt?: string | null
}

type BooleanField =
  | 'active'
  | 'weatherPublic'
  | 'opsPublic'
  | 'isInternal'
  | 'hasPhysicalAtc'
  | 'carouselBudgetEnabled'
  | 'globalLinkEnabled'
  | 'afisoOpen'
  | 'mobileEnabled'
type SortOrder = 'name-asc' | 'date-desc' | 'date-asc'

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Includes time (unlike formatDate above) - subscription history can
// plausibly get more than one entry on the same day, and "when exactly"
// is the whole point of this log existing.
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function patchTenant(id: number, body: Record<string, boolean | number | string | null>): Promise<PlatformTenant | null> {
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

// Reserved Owner Slots & Time Budget round - editable inline (MM:SS),
// same save-on-blur pattern as QuotaEditor above, just for
// tenants.carousel_budget_seconds instead of storage_quota_bytes. Only
// meaningful while carouselBudgetEnabled is on for this tenant (the
// toggle rendered alongside it), but always editable regardless - a
// value set while the feature is off just takes effect immediately
// once it's turned on, matching the "live immediately" requirement.
function CarouselBudgetEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (seconds: number) => void }): JSX.Element {
  const toMmSs = (totalSeconds: number) => `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
  const [value, setValue] = useState(toMmSs(tenant.carouselBudgetSeconds))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(toMmSs(tenant.carouselBudgetSeconds))
  }, [tenant.carouselBudgetSeconds])

  async function commit() {
    const match = value.trim().match(/^(\d+):([0-5]?\d)$/)
    const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds === tenant.carouselBudgetSeconds) {
      setValue(toMmSs(tenant.carouselBudgetSeconds))
      return
    }
    setSaving(true)
    const updated = await patchTenant(tenant.id, { carouselBudgetSeconds: seconds })
    setSaving(false)
    if (updated) onSaved(updated.carouselBudgetSeconds)
    else setValue(toMmSs(tenant.carouselBudgetSeconds))
  }

  return (
    <div className="min-w-[140px]">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">Carousel time budget</div>
      <input
        type="text"
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
        placeholder="2:30"
        className="mt-1 w-20 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-right text-xs text-white focus:border-sky-500 focus:outline-none"
      />
    </div>
  )
}

// Pilot View round - same save-on-blur pattern as CarouselBudgetEditor
// above, for tenants.afiso_frequency. Free text deliberately (see
// migration 0070's own comment on why validating a strict frequency
// pattern risks rejecting a real value) - no format check here either,
// just non-empty-vs-changed to avoid a no-op save.
function AfisoFrequencyEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (frequency: string) => void }): JSX.Element {
  const [value, setValue] = useState(tenant.afisoFrequency)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(tenant.afisoFrequency)
  }, [tenant.afisoFrequency])

  async function commit() {
    const trimmed = value.trim()
    if (trimmed === tenant.afisoFrequency) return
    setSaving(true)
    const updated = await patchTenant(tenant.id, { afisoFrequency: trimmed })
    setSaving(false)
    if (updated) onSaved(updated.afisoFrequency)
    else setValue(tenant.afisoFrequency)
  }

  return (
    <div className="min-w-[140px]">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">AFISO frequency</div>
      <input
        type="text"
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
        placeholder="122.250"
        className="mt-1 w-24 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-xs text-white focus:border-sky-500 focus:outline-none"
      />
    </div>
  )
}

// Same save-on-blur pattern as CarouselBudgetEditor/AfisoFrequencyEditor
// above, for tenants.qnh_qfe_offset_hpa (migration 0074). Empty field
// commits null (independent rounding, every tenant's default) - a
// meaningful, deliberately-chosen state, not just "nothing typed yet",
// so it's handled as its own branch below rather than falling through
// to a no-op. A non-empty value must be a plain integer - this is a
// physical hPa offset, not a free-text field like AFISO frequency.
// Read from the EFFECTIVE tenant server-side (publicConfig.ts) - see
// this field's own comment on PlatformTenant for why setting this on a
// tenant linked to a parent has no visible effect while the link
// exists.
function QnhQfeOffsetEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (offset: number | null) => void }): JSX.Element {
  const toInputValue = (offset: number | null) => (offset === null ? '' : String(offset))
  const [value, setValue] = useState(toInputValue(tenant.qnhQfeOffsetHpa))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(toInputValue(tenant.qnhQfeOffsetHpa))
  }, [tenant.qnhQfeOffsetHpa])

  async function commit() {
    const trimmed = value.trim()
    if (trimmed === '') {
      if (tenant.qnhQfeOffsetHpa === null) return
      setSaving(true)
      const updated = await patchTenant(tenant.id, { qnhQfeOffsetHpa: null })
      setSaving(false)
      if (updated) onSaved(updated.qnhQfeOffsetHpa)
      else setValue(toInputValue(tenant.qnhQfeOffsetHpa))
      return
    }
    const offset = Number(trimmed)
    if (!Number.isInteger(offset) || offset === tenant.qnhQfeOffsetHpa) {
      setValue(toInputValue(tenant.qnhQfeOffsetHpa))
      return
    }
    setSaving(true)
    const updated = await patchTenant(tenant.id, { qnhQfeOffsetHpa: offset })
    setSaving(false)
    if (updated) onSaved(updated.qnhQfeOffsetHpa)
    else setValue(toInputValue(tenant.qnhQfeOffsetHpa))
  }

  return (
    <div className="min-w-[140px]">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">QNH/QFE fixed offset (hPa)</div>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
        placeholder="Off"
        className="mt-1 w-20 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-right text-xs text-white focus:border-sky-500 focus:outline-none"
      />
    </div>
  )
}

// Manages this tenant's tenants.parent_tenant_id column (migration
// 0059) via functions/api/platform/tenants/[id]/parent-tenant.ts -
// built during the ATC/PC2 multi-tenant migration to support co-located
// clubs (e.g. a gyrocopter/microlight tenant at Shobdon inheriting
// Shobdon's own ATC station, forecast, NOTAMs, gas prices, and runway/
// compass data instead of running its own of each). Renamed from
// WeatherShareEditor/tenant_weather_shares (migration 0029) - that
// mechanism only ever expressed this exact same "co-located, one parent
// per tenant" relationship for weather specifically; this round
// generalized it once four more domains needed the identical
// relationship. Fetches the current link fresh on every tenant switch
// (own effect, not derived from the tenants list response - that
// endpoint doesn't carry this) since it's cross-tenant admin-only
// state, same posture as has_physical_atc. Deliberately generic: any
// tenant can be picked as the parent, not just Shobdon - this is the
// same mechanism for any future main-airfield-plus-neighbours
// arrangement.
function ParentAirfieldEditor({
  tenant,
  allTenants,
}: {
  tenant: PlatformTenant
  allTenants: PlatformTenant[]
}): JSX.Element {
  const [parentSlug, setParentSlug] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${TENANTS_URL}/${tenant.id}/parent-tenant`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setParentSlug(data?.parentTenantSlug ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tenant.id])

  async function handleChange(nextSlug: string) {
    const value = nextSlug || null
    setSaving(true)
    const response = await fetch(`${TENANTS_URL}/${tenant.id}/parent-tenant`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentTenantSlug: value }),
    })
    const data = response.ok ? await response.json().catch(() => null) : null
    setSaving(false)
    setParentSlug(data?.parentTenantSlug ?? null)
  }

  const otherTenants = allTenants.filter((t) => t.id !== tenant.id)

  return (
    <div className="min-w-[220px]">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-400">Parent Airfield</div>
      <select
        value={parentSlug ?? ''}
        disabled={loading || saving}
        onChange={(event) => handleChange(event.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">— Independent (no parent) —</option>
        {otherTenants.map((t) => (
          <option key={t.id} value={t.slug}>
            {t.name} ({t.slug})
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-muted-500">
        When set, this tenant's dashboard mirrors the parent's live weather station reading, Met Office forecast,
        NOTAMs, gas prices, runway/compass data, and active-runway/circuit status - never its own stored data for
        those, and never overwritten by this link either (unlinking cleanly reverts to whatever this tenant had on
        its own). Clubhouse notices are never inherited. This tenant's own Weather Config source must still be set
        to &quot;Third-Party Station&quot; for the weather reading itself to take effect.
      </p>
    </div>
  )
}

// Same inline-edit-on-blur pattern as QuotaEditor above - a developer
// customer-service fix (e.g. a tenant's name has a typo or their logo
// was uploaded badly-sized) shouldn't need a separate "Edit" mode.
// Status saves immediately on change (a <select> choice is already a
// deliberate discrete action, same as the BooleanToggle checkboxes
// elsewhere on this page) - notes save on blur, matching NameEditor's
// free-text convention below. onSaved takes no argument and just
// triggers a full tenant-list refetch (see refreshTenants) -
// unlike the other *Saved callbacks, the PATCH response doesn't include
// the newly-appended subscription_history row, so a targeted local
// patch can't reflect it; a refetch is simpler and correct rather than
// hand-constructing a history entry client-side without the server's
// own timestamp/id.
function SubscriptionEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: () => void }): JSX.Element {
  const [status, setStatus] = useState<SubscriptionStatus>(tenant.subscriptionStatus)
  const [notes, setNotes] = useState(tenant.subscriptionNotes)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setStatus(tenant.subscriptionStatus)
    setNotes(tenant.subscriptionNotes)
  }, [tenant.subscriptionStatus, tenant.subscriptionNotes])

  async function commitStatus(next: SubscriptionStatus) {
    if (next === tenant.subscriptionStatus) return
    const previous = status
    setStatus(next)
    setSaving(true)
    const updated = await patchTenant(tenant.id, { subscriptionStatus: next })
    setSaving(false)
    if (updated) onSaved()
    else setStatus(previous)
  }

  async function commitNotes() {
    if (notes === tenant.subscriptionNotes) return
    setSaving(true)
    const updated = await patchTenant(tenant.id, { subscriptionNotes: notes })
    setSaving(false)
    if (updated) onSaved()
    else setNotes(tenant.subscriptionNotes)
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-muted-400">Status</span>
        <select
          value={status}
          disabled={saving}
          onChange={(event) => commitStatus(event.target.value as SubscriptionStatus)}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        >
          {SUBSCRIPTION_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-start gap-3">
        <span className="w-16 shrink-0 pt-2 text-xs uppercase tracking-wide text-muted-400">Notes</span>
        <textarea
          value={notes}
          disabled={saving}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={commitNotes}
          rows={2}
          placeholder="e.g. paying by bank transfer quarterly, next review March"
          className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
      </label>
    </div>
  )
}

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
          accept="image/png,image/jpeg,image/svg+xml,image/webp,image/avif"
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
function MemberRow({
  member,
  onResetPassword,
  onRemove,
}: {
  member: PlatformMember
  onResetPassword: () => void
  onRemove: () => void
}): JSX.Element {
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
          <button type="button" onClick={onResetPassword} className="text-xs font-semibold text-accent-sky-400 hover:text-accent-sky-500">
            Reset password
          </button>
          <button type="button" onClick={onRemove} className="text-xs font-semibold text-status-bad hover:opacity-80">
            Remove
          </button>
        </div>
      )}
    </div>
  )
}

// Same clipboard-copy pattern as MembersPage.tsx's own CopyButton -
// navigator.clipboard.writeText can reject (permissions, non-secure
// context), silently no-op rather than showing a broken error state
// since the password text is still visible to select/copy by hand.
function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // no-op, see comment above
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:border-sky-500"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// Cross-tenant member management for the selected tenant - mirrors
// MembersPage.tsx's own add/remove/reset-password flow and styling
// exactly, just pointed at the new requirePlatformAdmin-gated endpoints
// (functions/api/platform/tenants/[id]/members/*) instead of the
// owner-scoped tenant-facing ones, since those can't be called on an
// arbitrary tenant. onChanged triggers the same full-refetch pattern
// already used elsewhere on this page (subscription save, archive) -
// simplest way to get the server's own member id/timestamp into view
// after an add, rather than hand-constructing the new row client-side.
function MembersSection({ tenant, onChanged }: { tenant: PlatformTenant; onChanged: () => void }): JSX.Element {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('admin')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revealedPassword, setRevealedPassword] = useState<{ email: string; password: string } | null>(null)

  // Resets the form/reveal state when switching to a different tenant -
  // a temp password revealed for tenant A must never linger on screen
  // after selecting tenant B.
  useEffect(() => {
    setEmail('')
    setRole('admin')
    setError(null)
    setRevealedPassword(null)
  }, [tenant.id])

  async function handleAddMember(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setRevealedPassword(null)
    try {
      const response = await fetch(`${TENANTS_URL}/${tenant.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? 'Failed to add member')
        return
      }
      if (data?.temporaryPassword) setRevealedPassword({ email: data.email, password: data.temporaryPassword })
      setEmail('')
      onChanged()
    } catch {
      setError('Failed to add member')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(member: PlatformMember) {
    if (!window.confirm(`Remove ${member.email}'s access to ${tenant.name}? This takes effect immediately.`)) return
    const response = await fetch(`${TENANTS_URL}/${tenant.id}/members/${member.id}`, { method: 'DELETE' })
    if (response.ok) onChanged()
  }

  async function handleResetPassword(member: PlatformMember) {
    if (
      !window.confirm(`Generate a new temporary password for ${member.email}? Their current password stops working immediately.`)
    ) {
      return
    }
    const response = await fetch(`${TENANTS_URL}/${tenant.id}/members/${member.id}/reset-password`, { method: 'POST' })
    const data = await response.json().catch(() => null)
    if (response.ok && data?.temporaryPassword) setRevealedPassword({ email: member.email, password: data.temporaryPassword })
  }

  return (
    <div>
      {revealedPassword && (
        <div className="mb-4 rounded-xl border border-accent-sky-500 bg-panel p-4">
          <div className="mb-1 text-xs font-bold uppercase tracking-widest text-accent-sky-400">
            Temporary password for {revealedPassword.email}
          </div>
          <div className="mb-2 flex items-center gap-3">
            <div className="font-mono text-xl text-white">{revealedPassword.password}</div>
            <CopyButton text={revealedPassword.password} />
          </div>
          <p className="text-xs text-status-bad">Copy this now — it won't be shown again.</p>
          <button
            type="button"
            onClick={() => setRevealedPassword(null)}
            className="mt-2 text-xs font-semibold text-muted-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {tenant.members.length === 0 ? (
        <span className="text-xs text-muted-500">No members yet</span>
      ) : (
        <div className="mb-4 flex flex-col gap-3">
          {tenant.members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              onResetPassword={() => handleResetPassword(member)}
              onRemove={() => handleRemove(member)}
            />
          ))}
        </div>
      )}

      <form onSubmit={handleAddMember} className="flex flex-wrap items-end gap-3 border-t border-border/60 pt-4">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-400">Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            {PLATFORM_ADDABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent-sky-500 px-4 py-2 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add member'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm font-semibold text-status-bad">{error}</p>}
    </div>
  )
}

// Genuine, irreversible deletion (functions/api/platform/tenants/[id]/
// hard-delete.ts) - explicitly a developer/testing tool for disposing
// of throwaway tenants created while testing "Onboard New Tenant", NOT
// a customer-offboarding feature (see that endpoint's own comment).
// Only ever rendered for an already-archived tenant (selectedTenant.
// deletedAt truthy - enforced by this section's own caller, not
// re-checked here), matching the same "follow-up action on something
// already disposed of" framing Archive itself uses. Confirm-by-typing,
// not window.confirm - this needs the tenant's exact slug or name typed
// (matches the server's own check), a meaningfully higher bar than a
// single OK-click for an action this permanent.
function HardDeleteSection({ tenant, onDeleted }: { tenant: PlatformTenant; onDeleted: () => void }): JSX.Element {
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = confirmText.trim() === tenant.slug || confirmText.trim() === tenant.name

  async function handleDelete() {
    if (!matches) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`${TENANTS_URL}/${tenant.id}/hard-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmText.trim() }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error ?? 'Failed to permanently delete this tenant')
        return
      }
      onDeleted()
    } catch {
      setError('Failed to permanently delete this tenant')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border-2 border-status-bad bg-status-bad/5 p-4">
      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-status-bad">
        Permanently delete — for test/dev tenants only
      </div>
      <p className="mb-3 text-xs text-muted-400">
        Irreversible. Removes every row and uploaded file for {tenant.name} completely - not another archive, an
        actual deletion. Only use this for throwaway tenants created while testing, never for a real customer who
        left.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={confirmText}
          disabled={submitting}
          onChange={(event) => setConfirmText(event.target.value)}
          placeholder={`Type "${tenant.slug}" to confirm`}
          className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-status-bad focus:outline-none"
        />
        <button
          type="button"
          onClick={handleDelete}
          disabled={!matches || submitting}
          className="rounded-lg bg-status-bad px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Deleting…' : 'Permanently delete'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-status-bad">{error}</p>}
    </div>
  )
}

// Plain reverse-chronological list row, matching /platform/visits's own
// plain-list convention for this kind of log rather than inventing a
// third one. Server already sorts newest-first (see this endpoint's own
// ORDER BY changed_at DESC), so no client-side sort needed here.
function HistoryEntryRow({ entry }: { entry: SubscriptionHistoryEntry }): JSX.Element {
  const label = SUBSCRIPTION_STATUS_OPTIONS.find((option) => option.value === entry.status)?.label ?? entry.status
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="text-xs text-muted-500">{formatDateTime(entry.changedAt)}</span>
      </div>
      {entry.note && <div className="mt-1 text-xs text-muted-400">{entry.note}</div>}
      {entry.changedByEmail && <div className="mt-1 text-xs text-muted-500">by {entry.changedByEmail}</div>}
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
        setDashboardLandingPage(role === 'atc' ? '/atc-control' : role === 'media' ? '/media-manager' : role === 'cafe' ? '/cafe-media' : '/config')
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
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')

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

  // Left-list display order only - doesn't touch `tenants` itself or the
  // auto-select-first-on-load effect above, which both still key off the
  // server's own created_at-ascending order. 'date-desc' rather than
  // relying on the backend's ORDER BY (already oldest-first) so "newest
  // first" doesn't silently mean "reverse of whatever the API happens to
  // return."
  const sortedTenants = useMemo(() => {
    const copy = [...tenants]
    if (sortOrder === 'name-asc') copy.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortOrder === 'date-desc') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    else copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return copy
  }, [tenants, sortOrder])

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

  function handleCarouselBudgetSaved(tenantId: number, seconds: number) {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, carouselBudgetSeconds: seconds } : t)))
  }

  function handleAfisoFrequencySaved(tenantId: number, frequency: string) {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, afisoFrequency: frequency } : t)))
  }

  function handleQnhQfeOffsetSaved(tenantId: number, offset: number | null) {
    setTenants((prev) => prev.map((t) => (t.id === tenantId ? { ...t, qnhQfeOffsetHpa: offset } : t)))
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

  // Full refetch, not a targeted local patch - both subscription saves
  // (the PATCH response doesn't carry the newly-appended
  // subscription_history row - see SubscriptionEditor's own comment) and
  // member add/remove/reset (the server assigns the member id, and a
  // removal needs the row gone from local state too) are simplest to
  // just re-fetch from source rather than hand-reconstructing the
  // resulting shape client-side.
  async function refreshTenants() {
    const response = await fetch(TENANTS_URL)
    const data = response.ok ? await response.json() : null
    if (data) setTenants(data.tenants ?? [])
  }

  // Confirm-gated, reuses the existing generic optimistic toggle -
  // relabeled "Suspend"/"Resume" in the UI, but this is exactly today's
  // `active` flag, unchanged (see resolveTenantHost.ts's own comment on
  // what it does/doesn't affect - unlike Archive below, this leaves the
  // tenant's own back-office reachable).
  function handleSuspendToggle(tenant: PlatformTenant) {
    const next = !tenant.active
    const message = next
      ? `Resume ${tenant.name}? Their public dashboard becomes reachable again immediately.`
      : `Suspend ${tenant.name}? Their public dashboard stops resolving immediately - their own team can still log in and manage settings, same as today.`
    if (!window.confirm(message)) return
    handleBooleanToggle(tenant, 'active', next)
  }

  // Migration 0044 - archiving is a LOCAL patch, deliberately not an
  // immediate refetch/deselect - GET /platform/tenants excludes
  // deleted_at IS NOT NULL going forward, so a real refetch would
  // remove this tenant from the list right away, and with it the only
  // way to reach the new hard-delete sub-panel below (that panel only
  // renders for an already-selected, already-archived tenant - see its
  // own comment). Keeping it selected in local state for the rest of
  // this session is what makes "archive, then immediately permanently
  // delete if you want to" possible in one sitting; a fresh page load
  // afterward won't show it again, matching the "excluded by default"
  // design unchanged from last round.
  async function handleArchiveTenant(tenant: PlatformTenant) {
    const message = `Archive ${tenant.name}? This goes further than suspending - their own team will be locked out of their back-office immediately too, not just the public dashboard. A "Permanently delete" option will appear below once this completes.`
    if (!window.confirm(message)) return
    const updated = await patchTenant(tenant.id, { archived: true })
    if (!updated) return
    setTenants((prev) => prev.map((t) => (t.id === tenant.id ? { ...t, active: false, deletedAt: updated.deletedAt } : t)))
  }

  // Unlike archive, a successful hard-delete really does mean this
  // tenant is gone - remove it from local state and clear selection,
  // rather than the archive path's "keep it around for this session"
  // treatment.
  function handleHardDeleted(tenantId: number) {
    setTenants((prev) => prev.filter((t) => t.id !== tenantId))
    setSelectedTenantId((prev) => (prev === tenantId ? null : prev))
  }

  const [onboarding, setOnboarding] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; slug: string } | null>(null)
  const [onboardError, setOnboardError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Wildcard DNS/Worker migration round: optional custom subdomain for
  // the new tenant - blank still falls back to onboard.ts's existing
  // random tenant-XXXXXXXX slug, unchanged. Lowercased as typed (server
  // requires lowercase, not silently normalized there - forcing it here
  // means what's typed is always exactly what gets validated, no
  // surprise mismatch).
  const [desiredSlug, setDesiredSlug] = useState('')
  // idle: empty field (falls back to random slug) or format-invalid
  // (shown via slugFormatError below, not this). checking/available/
  // unavailable only apply once the debounced PLATFORM_CHECK_SLUG_URL
  // call actually resolves - advisory only, onboard.ts's own UNIQUE-
  // constraint try/catch is the real guarantee, this just keeps Jeff
  // from ever submitting a slug it already knows is hopeless.
  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'available' | 'unavailable'; reason?: string }>(
    { status: 'idle' }
  )

  // Weather-share investigation round: required, not optional - a
  // tenant onboarded with no lat/lon on file has no sane weather
  // default at all (functions/api/public/weather-default.ts), which
  // silently cascaded to a real production tenant (Gyroplane Train)
  // showing fabricated mock weather with no indication anything was
  // wrong. Same plain-number-input pattern as AirfieldLocationSection.tsx's
  // own lat/lon fields (this tenant's own later self-service edit of the
  // same columns), not type="number" - keeps the same client-side
  // parse-and-range-check posture rather than relying on the browser's
  // own numeric input quirks.
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const parsedLat = Number(lat)
  const parsedLon = Number(lon)
  const latValid = lat.trim() !== '' && Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90
  const lonValid = lon.trim() !== '' && Number.isFinite(parsedLon) && parsedLon >= -180 && parsedLon <= 180

  const trimmedSlug = desiredSlug.trim()
  const slugFormatError =
    trimmedSlug && !SLUG_FORMAT.test(trimmedSlug)
      ? '3-63 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen'
      : null

  useEffect(() => {
    if (!trimmedSlug || slugFormatError) {
      setSlugCheck({ status: 'idle' })
      return
    }
    let cancelled = false
    setSlugCheck({ status: 'checking' })
    const timeoutId = window.setTimeout(() => {
      fetch(`${PLATFORM_CHECK_SLUG_URL}?slug=${encodeURIComponent(trimmedSlug)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          setSlugCheck(data.available ? { status: 'available' } : { status: 'unavailable', reason: data.reason })
        })
        .catch(() => {
          if (!cancelled) setSlugCheck({ status: 'idle' })
        })
    }, SLUG_CHECK_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [trimmedSlug, slugFormatError])

  async function handleOnboardTenant() {
    if (!latValid || !lonValid) return
    setOnboarding(true)
    setOnboardError(null)
    setInviteResult(null)
    try {
      const response = await fetch(PLATFORM_ONBOARD_TENANT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: trimmedSlug || undefined, lat: parsedLat, lon: parsedLon }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setOnboardError(data?.error || 'Failed to onboard a new tenant')
        return
      }
      setInviteResult({ inviteUrl: data.inviteUrl, slug: data.slug })
      setDesiredSlug('')
      setSlugCheck({ status: 'idle' })
      setLat('')
      setLon('')
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
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-black uppercase tracking-wide text-primary">
            <Link to={dashboardLandingPage} className="transition-colors hover:text-accent-sky-400" title="Back to Dashboard">
              Platform · Tenants
            </Link>
          </h1>
          <Link
            to="/platform/onboarding-content"
            className="pt-2 text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500"
          >
            Edit onboarding content →
          </Link>
        </div>

        {/* Own labeled block, not squeezed beside another link in the
            header row - the previous placement (Tom Galloway/Gyroplane
            Train round) was missable enough that a real onboard happened
            without it ever being noticed. Wildcard DNS/Worker migration
            round: optional custom subdomain, live-checked as Jeff types
            (debounced, PLATFORM_CHECK_SLUG_URL) rather than only finding
            out it's taken/invalid after clicking the button - blank
            still falls back to onboard.ts's own random tenant-XXXXXXXX
            slug, unchanged from before that round. */}
        <div className="mb-6 rounded-2xl border border-border bg-panel p-6">
          <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Onboard New Tenant</div>
          <p className="mb-4 text-xs text-muted-500">
            Creates a new tenant and a single-use invite link. Choose a subdomain, or leave it blank for a random one.
            Latitude/longitude are required - without them there's no sane weather default for the tenant to start from.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="onboard-subdomain" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                Subdomain (optional)
              </label>
              <input
                id="onboard-subdomain"
                type="text"
                value={desiredSlug}
                onChange={(event) => setDesiredSlug(event.target.value.toLowerCase())}
                placeholder="e.g. gyroplane-train"
                className="w-64 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
              />
              <p className="text-[11px] text-muted-500">
                {trimmedSlug || 'tenant-xxxxxxxx'}.airfieldcentral.com
                {slugFormatError && <span className="ml-2 text-status-bad">{slugFormatError}</span>}
                {!slugFormatError && slugCheck.status === 'checking' && <span className="ml-2 text-muted-400">Checking…</span>}
                {!slugFormatError && slugCheck.status === 'available' && <span className="ml-2 text-status-good">Available</span>}
                {!slugFormatError && slugCheck.status === 'unavailable' && (
                  <span className="ml-2 text-status-bad">{slugCheck.reason}</span>
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="onboard-lat" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                Latitude
              </label>
              <input
                id="onboard-lat"
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                placeholder="52.2416"
                inputMode="decimal"
                className="w-32 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="onboard-lon" className="text-xs font-semibold uppercase tracking-widest text-muted-400">
                Longitude
              </label>
              <input
                id="onboard-lon"
                value={lon}
                onChange={(event) => setLon(event.target.value)}
                placeholder="-2.8821"
                inputMode="decimal"
                className="w-32 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white placeholder:text-muted-500"
              />
            </div>
            <button
              type="button"
              onClick={handleOnboardTenant}
              disabled={
                onboarding ||
                !!slugFormatError ||
                slugCheck.status === 'checking' ||
                slugCheck.status === 'unavailable' ||
                !latValid ||
                !lonValid
              }
              className="shrink-0 rounded-lg bg-accent-sky-500 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
            >
              {onboarding ? 'Creating…' : 'Onboard new tenant'}
            </button>
          </div>
          {(lat.trim() !== '' && !latValid) || (lon.trim() !== '' && !lonValid) ? (
            <p className="mt-2 text-[11px] text-status-bad">Latitude must be -90 to 90, longitude -180 to 180.</p>
          ) : null}
        </div>

        <p className="mb-4 max-w-2xl text-sm text-muted-400">
          Every tenant, across every organization. Developer-only — controls suspend/resume, archive, cross-tenant
          public visibility, internal/template status, storage quota, subscription status, members, and per-display
          active/café-entitlement state for any tenant, regardless of which org you're currently switched to.
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
            <div className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value="name-asc">Name A-Z</option>
                <option value="date-desc">Newest first</option>
                <option value="date-asc">Oldest first</option>
              </select>
              <div className="flex max-h-[75vh] flex-col gap-1 overflow-y-auto rounded-2xl border border-border bg-panel p-2">
                {sortedTenants.map((tenant) => (
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
                      title={tenant.active ? 'Live' : 'Suspended'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{tenant.name}</span>
                      <span className="block truncate text-xs text-muted-500">
                        {tenant.slug} · Joined {formatDate(tenant.createdAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
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
                    <SettingsToggleRow
                      label="Reserved owner slots + time budget"
                      checked={selectedTenant.carouselBudgetEnabled}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'carouselBudgetEnabled', next)}
                    />
                    <SettingsToggleRow
                      label="Show live dashboard link on /global"
                      checked={selectedTenant.globalLinkEnabled}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'globalLinkEnabled', next)}
                    />
                    <SettingsToggleRow
                      label="AFISO open"
                      checked={selectedTenant.afisoOpen}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'afisoOpen', next)}
                    />
                    <SettingsToggleRow
                      label="Mobile Pilot View enabled"
                      checked={selectedTenant.mobileEnabled}
                      onChange={(next) => handleBooleanToggle(selectedTenant, 'mobileEnabled', next)}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-6">
                    <QuotaEditor tenant={selectedTenant} onSaved={(bytes) => handleQuotaSaved(selectedTenant.id, bytes)} />
                    <CarouselBudgetEditor
                      tenant={selectedTenant}
                      onSaved={(seconds) => handleCarouselBudgetSaved(selectedTenant.id, seconds)}
                    />
                    <AfisoFrequencyEditor
                      tenant={selectedTenant}
                      onSaved={(frequency) => handleAfisoFrequencySaved(selectedTenant.id, frequency)}
                    />
                    <QnhQfeOffsetEditor
                      tenant={selectedTenant}
                      onSaved={(offset) => handleQnhQfeOffsetSaved(selectedTenant.id, offset)}
                    />
                    <ParentAirfieldEditor tenant={selectedTenant} allTenants={tenants} />
                    <Link
                      to={`/platform/tenants/${selectedTenant.id}/carousel-owner-slots`}
                      className="rounded-lg border border-accent-sky-500/40 px-3 py-2 text-xs font-semibold text-accent-sky-400 transition hover:bg-accent-sky-500/10"
                    >
                      Manage reserved slots (5/8/12) →
                    </Link>
                  </div>

                  <PilotTickerSlotsEditor tenantId={selectedTenant.id} />

                  {/* Suspend + Archive, grouped and visually separated
                      from the four unrelated checkboxes above - both are
                      "make this tenant go away" actions (one temporary,
                      one meant to be permanent), not a settings toggle
                      like weather/ops/internal/ATC. Once archived, these
                      two buttons are replaced entirely by an "Archived"
                      indicator + the hard-delete sub-panel below -
                      un-archiving isn't part of this round's scope, and
                      leaving Suspend/Resume live here would let active
                      get toggled back on while deleted_at stays set, a
                      genuinely broken half-state (publicly reachable
                      again per resolveTenantHost.ts's active=1 check,
                      but still locked out of its own back-office per
                      requireTenant's deleted_at check, and still hidden
                      from this very list on next reload). */}
                  <div className="mt-4 border-t border-border/60 pt-4">
                    {selectedTenant.deletedAt ? (
                      <>
                        <p className="text-xs text-muted-500">
                          Archived {formatDate(selectedTenant.deletedAt)}. Suspend/Resume is unavailable while
                          archived.
                        </p>
                        <HardDeleteSection tenant={selectedTenant} onDeleted={() => handleHardDeleted(selectedTenant.id)} />
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleSuspendToggle(selectedTenant)}
                          className="rounded-lg border border-status-bad px-4 py-2 text-xs font-bold uppercase tracking-widest text-status-bad transition hover:bg-status-bad/10"
                        >
                          {selectedTenant.active ? 'Suspend tenant' : 'Resume tenant'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchiveTenant(selectedTenant)}
                          className="rounded-lg bg-status-bad px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition hover:opacity-90"
                        >
                          Archive tenant
                        </button>
                      </div>
                    )}
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
                  <MembersSection tenant={selectedTenant} onChanged={refreshTenants} />
                </section>

                {/* Migration 0043 - manual placeholder ahead of real
                    Stripe integration (see this page's own history: no
                    billing table existed before this). Separate from
                    the Tenant settings section's `active` toggle
                    (pause/resume) and Displays' `entitled` flag (café
                    add-on) - neither represents customer lifecycle
                    stage, which is what this is for. */}
                <section className="rounded-2xl border border-border bg-panel p-5">
                  <div className="mb-3 text-sm font-bold uppercase tracking-widest text-accent-sky-400">Subscription</div>
                  <SubscriptionEditor tenant={selectedTenant} onSaved={refreshTenants} />
                  <div className="mt-4 flex flex-col gap-2">
                    {selectedTenant.subscriptionHistory.length === 0 ? (
                      <span className="text-xs text-muted-500">No status changes recorded yet</span>
                    ) : (
                      selectedTenant.subscriptionHistory.map((entry) => <HistoryEntryRow key={entry.id} entry={entry} />)
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
