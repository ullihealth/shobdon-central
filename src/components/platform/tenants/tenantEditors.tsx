import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { MemberRole } from '../../../types/member'

// Editors and helpers for the developer-only Platform Tenants pages. Moved
// here unchanged from the old single-file src/pages/PlatformTenantsPage.tsx
// when that page was reorganised into a list + per-tenant tabs; every
// editor below keeps its original route, payload and save behaviour.
export const TENANTS_URL = '/api/platform/tenants'
export const REFRESH_DISPLAYS_URL = '/api/platform/refresh-displays'
export const FORCE_PILOT_UPDATE_URL = '/api/platform/force-pilot-update'

// 'owner' deliberately excluded - not addable via this flow, same as
// MembersPage.tsx's own ADDABLE_ROLES (owner is set once at tenant
// creation, never added later). Kept in sync with that file's list and
// functions/api/platform/tenants/[id]/members/index.ts's own server-side
// allowlist - 'cafe' added to all three together this round.
const PLATFORM_ADDABLE_ROLES: MemberRole[] = ['admin', 'atc', 'media', 'cafe']

export interface PlatformDisplay {
  id: number
  slug: string
  name: string
  templateId: string
  active: boolean
  entitled: boolean
  entitlementTrialExpiresAt: string | null
}

export interface PlatformMember {
  id: string
  email: string
  name: string
  role: string
  createdAt: string
}

// Migration 0043 - keep in sync with SUBSCRIPTION_STATUSES in
// functions/api/platform/tenants/[id].ts (that file is the source of
// truth/validation; this is just the matching client-side option list).
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'comped'
export const SUBSCRIPTION_STATUS_OPTIONS: { value: SubscriptionStatus; label: string }[] = [
  { value: 'trial', label: 'Trial' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past due' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'comped', label: 'Comped' },
]

export interface SubscriptionHistoryEntry {
  id: number
  status: string
  note: string
  changedByEmail: string | null
  changedAt: string
}

export interface PlatformTenant {
  id: number
  slug: string
  name: string
  subdomain: string
  active: boolean
  // migration 0090 - Café Reserved Owner Slots round added this to the
  // list endpoint's response so the "Manage reserved slots" link below
  // can pick the right destination page per tenant.
  tenantType: 'airfield' | 'venue_cafe'
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
  // Byte-verified buffering gate round (migration 0094) - per-tenant
  // opt-in for the whole-page black-screen "Buffering Media" gate on the
  // real public display route, deliberately independent of tenant_type
  // (a future airfield tenant running heavy ad content needs the exact
  // same option venue_cafe tenants do). Defaults on for megs-cafe-media,
  // off for every other tenant.
  fullBufferGateEnabled: boolean
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
  // Reception Dashboard entitlement (Airfield Pack round, migration
  // 0106) - gates '/' and '/d/:slug' for non-café templates only
  // (DashboardPage.tsx/TenantDisplayPage.tsx show DashboardLockedScreen
  // when false). Same testing-phase-only posture mobileEnabled above
  // already has - every existing tenant was backfilled to true.
  dashboardEnabled: boolean
  // Consistent QNH/QFE rounding round (migration 0074) - null (every
  // tenant's default) means "no known fixed offset, round QNH/QFE
  // independently"; a number means "this tenant's QNH and QFE always
  // differ by exactly this many hPa in reality" (11 for Shobdon).
  // Editable via QnhQfeOffsetEditor below. Read from the EFFECTIVE
  // tenant server-side (publicConfig.ts) - editing this on a tenant
  // that's linked to a parent has no visible effect while the link
  // exists, since the parent's own value wins.
  qnhQfeOffsetHpa: number | null
  // QR/phone-mockup rotation slide per-tenant config, Step 2 (migration
  // 0089, schema+backend landed in commit 8af682b). RightInfoPanel.tsx
  // does not read these yet - it still gates the slide on the
  // hardcoded tenantSlug === 'shobdon' stopgap (commit acef934) until a
  // later step switches it over. This round only makes the fields
  // editable here.
  qrSlideEnabled: boolean
  qrTargetUrl: string
  qrCaptionText: string
  qrMockupImageUrl: string | null
  // Media Box consent round (migration 0113) - mediaBoxConsentAt is set
  // once by either the activation or paid-signup consent checkbox (see
  // functions/api/tenant/media-box-consent/accept.ts and signup.ts's own
  // comments), never edited here. The three "issued" fields below ARE
  // editable here (MediaBoxIssuedEditor) - no real Pi Fleet<->tenant link
  // exists to reuse (pi_units.tenant_name is deliberately free text, not
  // a FK - see migration 0098's own comment), so these are simple,
  // independent fields.
  mediaBoxConsentAt: string | null
  mediaBoxIdentifier: string | null
  mediaBoxIssuedDate: string | null
  mediaBoxReturnedDate: string | null
  usedBytes: number
  logoUrl: string | null
  createdAt: string
  displays: PlatformDisplay[]
  members: PlatformMember[]
  subscriptionStatus: SubscriptionStatus
  // A Stripe subscription id is stored (webhook-written). With subscriptionStatus 'active' on a
  // SUSPENDED tenant this is the "Paid - awaiting Resume" badge (payment never resumes a tenant).
  hasStripeSubscription?: boolean
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

export type BooleanField =
  | 'active'
  | 'weatherPublic'
  | 'opsPublic'
  | 'isInternal'
  | 'hasPhysicalAtc'
  | 'carouselBudgetEnabled'
  | 'fullBufferGateEnabled'
  | 'globalLinkEnabled'
  | 'afisoOpen'
  | 'mobileEnabled'
  | 'dashboardEnabled'
  | 'qrSlideEnabled'
export type SortOrder = 'name-asc' | 'date-desc' | 'date-asc'

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Includes time (unlike formatDate above) - subscription history can
// plausibly get more than one entry on the same day, and "when exactly"
// is the whole point of this log existing.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function patchTenant(id: number, body: Record<string, boolean | number | string | null>): Promise<PlatformTenant | null> {
  const response = await fetch(`${TENANTS_URL}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.ok ? response.json() : null
}

// "Refresh displays" round - `tenant` is a slug (this tenant only) or
// the literal "all" (every active tenant, fanned out server-side by the
// Worker - see functions/api/platform/refresh-displays.ts's own
// comment). Returns whether the request succeeded; the endpoint itself
// is the auth boundary (requirePlatformAdmin) - the CAPTURE_KEY the
// Worker actually checks never reaches this client at all.
export async function triggerRefreshDisplays(tenant: string): Promise<boolean> {
  const response = await fetch(REFRESH_DISPLAYS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant }),
  })
  return response.ok
}

// "Force Pilot App update" - `tenant` is a slug or "all". Asks every open
// Pilot's App (on the new code) to update itself within about a minute; see
// functions/api/platform/force-pilot-update.ts. Separate from "Refresh
// displays" (dashboards), which deliberately never touches /pilot.
// "Log everyone out" - revokes every active session of the tenant's NON-developer
// members (never developers, never other tenants' users). Suspend does this too.
export async function triggerRevokeSessions(tenantId: number): Promise<{ users: number; sessions: number; alsoMemberOfOtherTenants: number } | null> {
  const response = await fetch(`${TENANTS_URL}/${tenantId}/revoke-sessions`, { method: 'POST' })
  return response.ok ? response.json() : null
}

// "Paid - awaiting Resume": the tenant is SUSPENDED but Stripe shows an active
// subscription. Payment deliberately never resumes a tenant (Resume is a manual
// developer action), so this is the prompt to do it.
export function isPaidAwaitingResume(tenant: PlatformTenant): boolean {
  return !tenant.active && tenant.subscriptionStatus === 'active' && !!tenant.hasStripeSubscription
}

export async function triggerForcePilotUpdate(tenant: string): Promise<boolean> {
  const response = await fetch(FORCE_PILOT_UPDATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant }),
  })
  return response.ok
}

export type DisplayPatchResult = { active: boolean; entitled: boolean; entitlementTrialExpiresAt: string | null }

export async function patchDisplay(
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
export function QuotaEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (bytes: number) => void }): JSX.Element {
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
        <input aria-label="Storage quota in MB"
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
export function CarouselBudgetEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (seconds: number) => void }): JSX.Element {
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
      <input aria-label="Carousel time budget"
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
export function AfisoFrequencyEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (frequency: string) => void }): JSX.Element {
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
      <input aria-label="AFISO frequency"
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

// Media Box consent round, Step 4 - simple "box issued/returned"
// tracking (migration 0113). Same save-on-blur pattern as
// AfisoFrequencyEditor above, for the three independent
// media_box_identifier/issued_date/returned_date fields - no real Pi
// Fleet<->tenant link exists to reuse (see PlatformTenant's own comment
// on mediaBoxIdentifier). Dates are plain free-text (yyyy-mm-dd via a
// native date input), not validated server-side beyond string-or-null.
export function MediaBoxIssuedEditor({
  tenant,
  onSaved,
}: {
  tenant: PlatformTenant
  onSaved: (fields: { mediaBoxIdentifier: string | null; mediaBoxIssuedDate: string | null; mediaBoxReturnedDate: string | null }) => void
}): JSX.Element {
  const [identifier, setIdentifier] = useState(tenant.mediaBoxIdentifier ?? '')
  const [issuedDate, setIssuedDate] = useState(tenant.mediaBoxIssuedDate ?? '')
  const [returnedDate, setReturnedDate] = useState(tenant.mediaBoxReturnedDate ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setIdentifier(tenant.mediaBoxIdentifier ?? '')
    setIssuedDate(tenant.mediaBoxIssuedDate ?? '')
    setReturnedDate(tenant.mediaBoxReturnedDate ?? '')
  }, [tenant.mediaBoxIdentifier, tenant.mediaBoxIssuedDate, tenant.mediaBoxReturnedDate])

  async function commit() {
    const nextIdentifier = identifier.trim() || null
    const nextIssuedDate = issuedDate || null
    const nextReturnedDate = returnedDate || null
    if (
      nextIdentifier === (tenant.mediaBoxIdentifier ?? null) &&
      nextIssuedDate === (tenant.mediaBoxIssuedDate ?? null) &&
      nextReturnedDate === (tenant.mediaBoxReturnedDate ?? null)
    ) {
      return
    }
    setSaving(true)
    const updated = await patchTenant(tenant.id, {
      mediaBoxIdentifier: nextIdentifier,
      mediaBoxIssuedDate: nextIssuedDate,
      mediaBoxReturnedDate: nextReturnedDate,
    })
    setSaving(false)
    if (updated) {
      onSaved({
        mediaBoxIdentifier: updated.mediaBoxIdentifier,
        mediaBoxIssuedDate: updated.mediaBoxIssuedDate,
        mediaBoxReturnedDate: updated.mediaBoxReturnedDate,
      })
    } else {
      setIdentifier(tenant.mediaBoxIdentifier ?? '')
      setIssuedDate(tenant.mediaBoxIssuedDate ?? '')
      setReturnedDate(tenant.mediaBoxReturnedDate ?? '')
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">Box identifier</div>
        <input aria-label="Box identifier"
          type="text"
          value={identifier}
          disabled={saving}
          onChange={(event) => setIdentifier(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
          placeholder="AA0001"
          className="mt-1 w-28 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-xs text-white focus:border-sky-500 focus:outline-none"
        />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">Issued</div>
        <input aria-label="Issued"
          type="date"
          value={issuedDate}
          disabled={saving}
          onChange={(event) => setIssuedDate(event.target.value)}
          onBlur={commit}
          className="mt-1 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-xs text-white focus:border-sky-500 focus:outline-none"
        />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">Returned</div>
        <input aria-label="Returned"
          type="date"
          value={returnedDate}
          disabled={saving}
          onChange={(event) => setReturnedDate(event.target.value)}
          onBlur={commit}
          className="mt-1 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-xs text-white focus:border-sky-500 focus:outline-none"
        />
      </div>
    </div>
  )
}

// QR/phone-mockup slide per-tenant config, Step 2 (migration 0089
// schema, commit 8af682b) - same save-on-blur pattern as
// AfisoFrequencyEditor above, for tenants.qr_target_url. Free text
// deliberately (no URL-format validation) - same reasoning
// AfisoFrequencyEditor's own comment gives for its field: a strict
// format check risks rejecting a real value more than it protects
// anything, and this is a developer-only control, not self-service.
// w-56 (224px), not AfisoFrequencyEditor's w-24 - a real target URL
// (e.g. "https://shobdon.airfieldcentral.com/pilot", 43 characters) is
// far longer than a radio frequency like "122.250"; w-56 shows most or
// all of a typical tenant subdomain URL at this font size without
// making this one field dominate the row the other compact editors
// share.
export function QrTargetUrlEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (targetUrl: string) => void }): JSX.Element {
  const [value, setValue] = useState(tenant.qrTargetUrl)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(tenant.qrTargetUrl)
  }, [tenant.qrTargetUrl])

  async function commit() {
    const trimmed = value.trim()
    if (trimmed === tenant.qrTargetUrl) return
    setSaving(true)
    const updated = await patchTenant(tenant.id, { qrTargetUrl: trimmed })
    setSaving(false)
    if (updated) onSaved(updated.qrTargetUrl)
    else setValue(tenant.qrTargetUrl)
  }

  return (
    <div className="min-w-[140px]">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">QR target URL</div>
      <input aria-label="QR target URL"
        type="text"
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
        placeholder="https://<tenant>.airfieldcentral.com/pilot"
        className="mt-1 w-56 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-xs text-white focus:border-sky-500 focus:outline-none"
      />
    </div>
  )
}

// Same shape as QrTargetUrlEditor above, for tenants.qr_caption_text.
// w-40 (160px) - wider than AfisoFrequencyEditor's w-24 (a caption like
// "SCAN FOR SHOBDON PILOT APP" is longer than a frequency), narrower
// than the URL field above (a caption is typically shorter than a full
// URL).
export function QrCaptionTextEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (captionText: string) => void }): JSX.Element {
  const [value, setValue] = useState(tenant.qrCaptionText)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(tenant.qrCaptionText)
  }, [tenant.qrCaptionText])

  async function commit() {
    const trimmed = value.trim()
    if (trimmed === tenant.qrCaptionText) return
    setSaving(true)
    const updated = await patchTenant(tenant.id, { qrCaptionText: trimmed })
    setSaving(false)
    if (updated) onSaved(updated.qrCaptionText)
    else setValue(tenant.qrCaptionText)
  }

  return (
    <div className="min-w-[140px]">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted-400">QR caption text</div>
      <input aria-label="QR caption text"
        type="text"
        value={value}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
        }}
        placeholder="SCAN FOR PILOT APP"
        className="mt-1 w-40 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-xs text-white focus:border-sky-500 focus:outline-none"
      />
    </div>
  )
}

export type RefreshDisplaysStatus = 'idle' | 'loading' | 'success' | 'error'

// "Refresh displays" round - an ACTION button, not a field editor like
// its neighbours above, but colocated here since it's the same
// per-tenant-row unit of UI. No confirm() gate, unlike Suspend/Archive
// further down this file - reloading one tenant's own live screen is
// low-stakes (a few seconds of blank/reload flash on THEIR OWN display,
// nothing destructive or irreversible), unlike the page-level "refresh
// all tenants" action below, which deliberately does confirm first
// given its much larger blast radius.
export function RefreshDisplaysButton({ tenant }: { tenant: PlatformTenant }): JSX.Element {
  const [status, setStatus] = useState<RefreshDisplaysStatus>('idle')

  async function handleClick() {
    setStatus('loading')
    const ok = await triggerRefreshDisplays(tenant.slug)
    setStatus(ok ? 'success' : 'error')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === 'loading'}
      className="rounded-lg border border-accent-sky-500/40 px-3 py-2 text-xs font-semibold text-accent-sky-400 transition hover:bg-accent-sky-500/10 disabled:opacity-60"
    >
      {status === 'loading'
        ? 'Refreshing…'
        : status === 'success'
          ? 'Refreshed ✓'
          : status === 'error'
            ? 'Failed - retry'
            : 'Refresh this tenant’s displays'}
    </button>
  )
}

// Per-tenant "Log everyone out" (confirm-gated). Signs out every NON-developer
// member of this tenant; tabs already open end up on the login page.
// The confirm + request live in a hook so the Danger zone menu and the Members
// tab run exactly the same action (same confirm text, same route).
export function useLogEveryoneOut(tenant: PlatformTenant): { run: () => Promise<void>; status: RefreshDisplaysStatus; detail: string } {
  const [status, setStatus] = useState<RefreshDisplaysStatus>('idle')
  const [detail, setDetail] = useState('')

  async function run() {
    if (
      !window.confirm(
        `Log everyone out of ${tenant.name}? Every active session of this tenant's non-developer members is revoked - open tabs go to the login page. Developers and other tenants' users are not affected.`
      )
    )
      return
    setStatus('loading')
    const result = await triggerRevokeSessions(tenant.id)
    setStatus(result ? 'success' : 'error')
    if (result) {
      setDetail(
        `${result.sessions} session${result.sessions === 1 ? '' : 's'} / ${result.users} user${result.users === 1 ? '' : 's'}` +
          (result.alsoMemberOfOtherTenants > 0 ? ` (${result.alsoMemberOfOtherTenants} also in another tenant)` : '')
      )
    }
  }

  return { run, status, detail }
}

export function LogEveryoneOutButton({ tenant }: { tenant: PlatformTenant }): JSX.Element {
  const { run, status, detail } = useLogEveryoneOut(tenant)

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={status === 'loading'}
        title="Revoke every active session of this tenant's non-developer members"
        className="min-h-[44px] rounded-lg border border-status-bad/60 px-3 py-2 text-xs font-semibold text-status-bad transition hover:bg-status-bad/10 disabled:opacity-60"
      >
        {status === 'loading' ? 'Logging out…' : status === 'success' ? 'Logged out ✓' : status === 'error' ? 'Failed - retry' : 'Log everyone out'}
      </button>
      {status === 'success' && detail && <span className="text-xs text-muted-500">{detail}</span>}
    </span>
  )
}

// Per-tenant "Force Pilot App update" (next to RefreshDisplaysButton). No
// confirm: it only makes that tenant's open Pilot's Apps reload onto the latest
// version, which is what an update is.
export function ForcePilotUpdateButton({ tenant }: { tenant: PlatformTenant }): JSX.Element {
  const [status, setStatus] = useState<RefreshDisplaysStatus>('idle')

  async function handleClick() {
    setStatus('loading')
    const ok = await triggerForcePilotUpdate(tenant.slug)
    setStatus(ok ? 'success' : 'error')
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === 'loading'}
      title="Open Pilot's Apps for this tenant update to the latest version within about a minute"
      className="rounded-lg border border-accent-sky-500/40 px-3 py-2 text-xs font-semibold text-accent-sky-400 transition hover:bg-accent-sky-500/10 disabled:opacity-60"
    >
      {status === 'loading'
        ? 'Forcing…'
        : status === 'success'
          ? 'Update forced ✓'
          : status === 'error'
            ? 'Failed - retry'
            : 'Force Pilot App update'}
    </button>
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
export function QnhQfeOffsetEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (offset: number | null) => void }): JSX.Element {
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
      <input aria-label="QNH/QFE fixed offset (hPa)"
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
export function ParentAirfieldEditor({
  tenant,
  allTenants,
  onChanged,
}: {
  tenant: PlatformTenant
  allTenants: PlatformTenant[]
  // Lets the tenant page header show the new parent without a refetch.
  onChanged?: (parentSlug: string | null) => void
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
    onChanged?.(data?.parentTenantSlug ?? null)
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
        <option value="">Independent (no parent)</option>
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
        its own). Clubhouse notices are never inherited. Setting a parent also sets this tenant's weather source to the
        parent's station automatically, and locks the source selector on the tenant's own Weather Config page while
        linked; clearing the parent hands the choice back.
      </p>
    </div>
  )
}

// Pilot camera view round - manages this tenant's tenants.
// primary_camera_slot_number/primary_camera_id (migration 0091) via
// functions/api/platform/tenants/[id]/primary-camera.ts. Structural
// clone of ParentAirfieldEditor just above: fetch current selection +
// candidate list fresh on every tenant switch, PUT on change, a plain
// <select> with a "— None —" clearing option. Unlike that editor,
// candidates come from the SERVER response (not a client-side prop),
// since they're this tenant's own camera_slots/cameras rows, not
// something PlatformTenantsPage already has loaded - see that route's
// own top comment for why it combines both mechanisms into one ref
// string ("slot:<n>" / "cam:<id>") rather than exposing two selects.
export function PrimaryCameraEditor({ tenant }: { tenant: PlatformTenant }): JSX.Element {
  const [candidates, setCandidates] = useState<{ ref: string; label: string }[]>([])
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${TENANTS_URL}/${tenant.id}/primary-camera`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        setCandidates(data?.candidates ?? [])
        setSelectedRef(data?.selectedRef ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tenant.id])

  async function handleChange(nextRef: string) {
    const value = nextRef || null
    setSaving(true)
    const response = await fetch(`${TENANTS_URL}/${tenant.id}/primary-camera`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: value }),
    })
    const data = response.ok ? await response.json().catch(() => null) : null
    setSaving(false)
    if (data) {
      setCandidates(data.candidates ?? [])
      setSelectedRef(data.selectedRef ?? null)
    }
  }

  return (
    <div className="min-w-[220px]">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-400">Primary Camera (Pilot View)</div>
      <select
        value={selectedRef ?? ''}
        disabled={loading || saving}
        onChange={(event) => handleChange(event.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none disabled:opacity-50"
      >
        <option value="">(None)</option>
        {candidates.map((c) => (
          <option key={c.ref} value={c.ref}>
            {c.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-muted-500">
        The camera /pilot's camera icon opens. Only cameras with a real, non-LAN-only feed actually play there - a
        mode="local"-only camera shows as configured here but reads as "no usable camera" on /pilot itself (every
        /pilot client is off-site, never on the airfield's own network). Independent of which camera(s) this
        tenant's TV dashboard carousel shows.
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
export function SubscriptionEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: () => void }): JSX.Element {
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

// Stripe groundwork Part C - generates a single-use, expiring
// /activate/:token link for an EXISTING tenant (Tiger, id 29, is the
// motivating case) to pay for a plan without going through new-tenant
// signup/cloning. functions/api/platform/tenants/[id]/activation-link.ts
// is the real boundary (platform-admin gated, refuses a tenant that
// already has a live stripe_subscription_id) - this is just the UI
// around it, same "server is the real guarantee" posture every other
// control on this page already has.
export function ActivationLinkSection({ tenant }: { tenant: PlatformTenant }): JSX.Element {
  const [plan, setPlan] = useState<'pack' | 'pilotApp'>('pack')
  // Media Box consent round - "default ON when I create the link" per
  // the go-ahead, mirroring the server's own default (activation-link.ts's
  // own `includesMediaBox = body?.includesMediaBox === false ? false : true`).
  const [includesMediaBox, setIncludesMediaBox] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    setCreating(true)
    setError(null)
    setLink(null)
    try {
      const response = await fetch(`${TENANTS_URL}/${tenant.id}/activation-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, includesMediaBox }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.activationUrl) {
        setError(data?.error ?? 'Could not create activation link')
        return
      }
      setLink(data.activationUrl)
    } finally {
      setCreating(false)
    }
  }

  function handleCopy() {
    if (!link) return
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-slate-900/60 p-3">
      <div className="mb-2 text-[18px] font-semibold leading-tight text-slate-50">Activation link</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value as 'pack' | 'pilotApp')}
          className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
        >
          <option value="pack">Airfield Pack</option>
          <option value="pilotApp">Pilot's App</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={includesMediaBox}
            onChange={(event) => setIncludesMediaBox(event.target.checked)}
          />
          Includes Media Box loan
        </label>
        <button
          type="button"
          disabled={creating}
          onClick={handleCreate}
          className="rounded-lg bg-accent-sky-500 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-accent-sky-400 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create activation link'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-status-bad">{error}</p>}
      {link && (
        <div className="mt-2 flex items-center gap-2">
          <input readOnly value={link} className="w-full rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-300" />
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs font-semibold text-slate-100 hover:border-slate-400"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-500">Expires in 7 days. Single-use - refused if {tenant.name} already has an active subscription.</p>
    </div>
  )
}

// Stripe groundwork Part F - developer notification for new paid
// signups, simplest option first (no email provider wired - see this
// round's own investigation). Sourced from functions/api/platform/
// new-signups.ts, which reads subscription_history (already written by
// the webhook's own checkout.session.completed handler) - no new table.
export interface NewSignup {
  tenantId: number
  name: string
  slug: string
  firstCheckoutAt: string
}

export function NewSignupsBadge(): JSX.Element | null {
  const [count, setCount] = useState(0)
  const [signups, setSignups] = useState<NewSignup[]>([])
  const [open, setOpen] = useState(false)

  function load() {
    fetch('/api/platform/new-signups')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return
        setCount(data.count ?? 0)
        setSignups(data.signups ?? [])
      })
      .catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDismiss() {
    await fetch('/api/platform/new-signups', { method: 'POST' })
    setOpen(false)
    load()
  }

  if (count === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-widest text-emerald-400 transition hover:bg-emerald-500/20"
      >
        {count} new signup{count === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-lg border border-border bg-panel p-3 shadow-xl">
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {signups.map((signup) => (
              <li key={signup.tenantId} className="text-sm text-slate-200">
                <span className="font-semibold">{signup.name}</span>
                <span className="block text-xs text-muted-500">
                  {signup.slug} · {formatDate(signup.firstCheckoutAt)}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={handleDismiss}
            className="mt-3 w-full rounded border border-slate-600 px-2 py-1.5 text-xs font-semibold text-slate-100 hover:border-slate-400"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

export function NameEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (name: string) => void }): JSX.Element {
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
export function LogoEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (logoUrl: string) => void }): JSX.Element {
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

// QR/phone-mockup slide per-tenant config, Step 2 (migration 0089
// schema, commit 8af682b) - direct mirror of LogoEditor above (same
// thumbnail-preview + hidden-file-input-under-a-label shape, same
// Uploading…/Replace states), posting to the already-built
// tenants/[id]/qr-mockup endpoint (functions/api/_utils/qrMockupUpload.ts)
// instead of .../logo. Placed next to LogoEditor in the same row per
// the earlier investigation's own reasoning - grouping "the two image
// assets this tenant has" together reads more naturally than splitting
// one off into the text-field row below.
export function QrMockupEditor({ tenant, onSaved }: { tenant: PlatformTenant; onSaved: (mockupImageUrl: string) => void }): JSX.Element {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const response = await fetch(`${TENANTS_URL}/${tenant.id}/qr-mockup`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.error || 'Upload failed')
        return
      }
      if (data?.mockupImageUrl) onSaved(data.mockupImageUrl as string)
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-14 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900/80">
        {tenant.qrMockupImageUrl ? (
          <img src={tenant.qrMockupImageUrl} alt="" className="h-full w-full object-contain" />
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
// support/maintenance force-off, shown for every display slug this
// tenant has - unrelated to billing/entitlement. cafe-tv's own
// `entitled` + trial-expiry (Part C's café billing gate) moved out to
// MediaScreenEntitlementEditor above, its own promoted card (Reception
// Dashboard entitlement round) - this component now only ever renders
// the one generic toggle, for every display including cafe-tv's own
// `active` flag (still here; only `entitled`/trial moved).
export function DisplayControls({
  tenantId,
  display,
  onSaved,
}: {
  tenantId: number
  display: PlatformDisplay
  onSaved: (displayId: number, patch: Partial<DisplayPatchResult>) => void
}): JSX.Element {
  const saved = useSavedFlash()
  async function toggleActive(next: boolean) {
    onSaved(display.id, { active: next })
    const updated = await patchDisplay(tenantId, display.id, { active: next })
    if (!updated) onSaved(display.id, { active: !next })
    saved.flash(!!updated)
  }

  return (
    <div className="mb-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1.5 last:mb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">{display.slug}</span>
        <label className="flex min-h-[44px] items-center gap-2 text-xs text-muted-300">
          <SavedPill state={saved.state} />
          <input type="checkbox" checked={display.active} onChange={(event) => toggleActive(event.target.checked)} className="h-5 w-5" />
          active
        </label>
      </div>
      <p className="mt-1 text-[10px] text-muted-500">
        Support/maintenance force-off for this one display only - unrelated to billing or entitlement.
      </p>
    </div>
  )
}

// Promoted out of the generic Displays list into its own Media Screen
// card - same toggleField/commitExpiry/clearExpiry shape DisplayControls
// above already used for this exact cafe-tv row, just given its own
// component so it can render standalone rather than nested inside a
// per-display loop. Only ever called with the tenant's 'cafe-tv' display
// row (found by the caller) - renders nothing sensible for any other
// slug, same single-purpose scope DisplayControls's own cafe-tv-only
// block already had.
export function MediaScreenEntitlementEditor({
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

  const saved = useSavedFlash()
  async function toggleEntitled(next: boolean) {
    onSaved(display.id, { entitled: next })
    const updated = await patchDisplay(tenantId, display.id, { entitled: next })
    if (!updated) onSaved(display.id, { entitled: !next })
    saved.flash(!!updated)
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-300">Media Screen entitled</span>
        <span className="flex items-center gap-2">
          <SavedPill state={saved.state} />
          <BooleanToggle checked={display.entitled} onChange={toggleEntitled} label="Media Screen entitled" />
        </span>
      </div>
      <p className="text-xs text-muted-500">
        Whether the café/clubhouse screen (cafe-tv) is unlocked for this tenant - the actual Media Screen paywall
        flag. Off shows nothing at /d/cafe-tv.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-400">Trial ends</span>
        <input aria-label="Media Screen trial end date"
          type="date"
          value={expiryInput}
          disabled={savingExpiry}
          onChange={(event) => setExpiryInput(event.target.value)}
          onBlur={commitExpiry}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-white focus:border-sky-500 focus:outline-none"
        />
        {display.entitlementTrialExpiresAt && (
          <button type="button" onClick={clearExpiry} className="text-xs text-slate-500 hover:text-slate-300">
            clear
          </button>
        )}
        {isExpiredTrial && <span className="text-xs font-bold text-status-bad">expired</span>}
      </div>
      <p className="text-xs text-muted-500">
        Optional - leave blank for an ordinary paid subscription. Set a date to give a time-limited trial that
        switches itself off automatically once it passes, with no other action needed.
      </p>
    </div>
  )
}

// Small "Saved" confirmation for controls that save the moment they are
// toggled. flash(true) shows "Saved", flash(false) shows "Not saved" (the
// caller has already reverted the control); both fade after two seconds.
export function useSavedFlash(): { state: 'idle' | 'saved' | 'failed'; flash: (ok: boolean) => void } {
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])
  function flash(ok: boolean) {
    setState(ok ? 'saved' : 'failed')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }
  return { state, flash }
}

export function SavedPill({ state }: { state: 'idle' | 'saved' | 'failed' }): JSX.Element | null {
  if (state === 'idle') return null
  return (
    <span
      role="status"
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
        state === 'saved' ? 'bg-status-good/15 text-status-good' : 'bg-status-bad/15 text-status-bad'
      }`}
    >
      {state === 'saved' ? 'Saved' : 'Not saved'}
    </span>
  )
}

export function BooleanToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}): JSX.Element {
  return (
    <label className="flex min-h-[44px] min-w-[44px] items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
        className="h-5 w-5"
      />
    </label>
  )
}

// A settings-list row - visible text label + BooleanToggle, replacing
// the old table's column-header-as-label convention now that these
// live in the detail pane's stacked sections instead of table cells.
// helper: a short, plain-English line explaining what this control does,
// written for a non-technical admin - not a developer comment. warning
// renders in status-bad red instead of the normal muted tone, for the
// one control (Has physical ATC) where getting this wrong has a real,
// immediate consequence (breaks the tenant's own live weather) rather
// than just being a cosmetic/platform-internal setting.
export function SettingsToggleRow({
  label,
  checked,
  onChange,
  helper,
  warning,
}: {
  label: string
  checked: boolean
  // May return a promise resolving to false when the save failed (the caller
  // has already reverted the control) - drives the "Saved" / "Not saved" pill.
  onChange: (next: boolean) => void | boolean | Promise<void | boolean>
  helper?: string
  warning?: string
}): JSX.Element {
  const { state, flash } = useSavedFlash()
  async function handleChange(next: boolean) {
    const result = await onChange(next)
    flash(result !== false)
  }
  return (
    <div className="border-b border-border/60 px-5 py-3.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-300">{label}</span>
        <span className="flex items-center gap-2">
          <SavedPill state={state} />
          <BooleanToggle checked={checked} onChange={handleChange} label={label} />
        </span>
      </div>
      {helper && <p className="mt-1 text-xs text-muted-500">{helper}</p>}
      {warning && <p className="mt-1 text-xs font-semibold text-status-bad">{warning}</p>}
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
export function MemberRow({
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
export function CopyButton({ text }: { text: string }): JSX.Element {
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
export function MembersSection({ tenant, onChanged }: { tenant: PlatformTenant; onChanged: () => void }): JSX.Element {
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
          <div className="mb-1 text-[18px] font-semibold leading-tight text-slate-50">
            Temporary password for {revealedPassword.email}
          </div>
          <div className="mb-2 flex items-center gap-3">
            <div className="font-mono text-xl text-white">{revealedPassword.password}</div>
            <CopyButton text={revealedPassword.password} />
          </div>
          <p className="text-xs text-status-bad">Copy this now - it won't be shown again.</p>
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
export function HardDeleteSection({ tenant, onDeleted }: { tenant: PlatformTenant; onDeleted: () => void }): JSX.Element {
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
        Permanently delete - for test/dev tenants only
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
export function HistoryEntryRow({ entry }: { entry: SubscriptionHistoryEntry }): JSX.Element {
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
