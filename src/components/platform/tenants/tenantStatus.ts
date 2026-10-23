// Pure helpers for the Platform Tenants list and tenant pages: status
// badges, "needs attention" issues, filter chips and search. Everything is
// derived from data the existing endpoints already return
// (GET /api/platform/tenants and GET /api/platform/pi-units) - nothing here
// calls the network, so it is unit-tested directly (scripts/platform-tenants-page.test.mjs).
import type { PlatformTenant } from './tenantEditors'

// The subset of GET /api/platform/pi-units this page reads.
export interface PiUnitSummary {
  id: number
  serialNumber: string
  tenantId: number | null
  tenantName: string | null
  status: string
  tvScheduleLastSeenAt: string | null
}

// A box polls tv-schedule every minute, so five minutes without a check-in
// is "offline" on the list; one hour is where the Overview starts to flag it.
export const PI_ONLINE_WINDOW_MS = 5 * 60 * 1000
export const PI_OFFLINE_ALERT_MS = 60 * 60 * 1000

export type PiState = 'online' | 'offline' | 'unknown'

export function piState(unit: PiUnitSummary | undefined, now: number): PiState {
  if (!unit || !unit.tvScheduleLastSeenAt) return 'unknown'
  const seen = new Date(unit.tvScheduleLastSeenAt).getTime()
  if (!Number.isFinite(seen)) return 'unknown'
  return now - seen <= PI_ONLINE_WINDOW_MS ? 'online' : 'offline'
}

export function piUnitsForTenant(units: PiUnitSummary[], tenantId: number): PiUnitSummary[] {
  return units.filter((unit) => unit.tenantId === tenantId)
}

export function isArchived(tenant: PlatformTenant): boolean {
  return !!tenant.deletedAt
}

// "Paying" = Stripe has a stored subscription id (webhook-written) and the
// subscription status is active. Same test the old page used for its
// "Paid - awaiting Resume" badge.
export function isPaying(tenant: PlatformTenant): boolean {
  return tenant.subscriptionStatus === 'active' && !!tenant.hasStripeSubscription
}

export function isPaidAwaitingResume(tenant: PlatformTenant): boolean {
  return !tenant.active && isPaying(tenant)
}

export type BadgeTone = 'red' | 'amber' | 'blue' | 'grey' | 'green'
export interface Badge {
  label: string
  tone: BadgeTone
}

// Main status badges, most important first. No "Complimentary" marker exists
// (Decisions Addendum #22), so nothing here invents one.
export function statusBadges(tenant: PlatformTenant): Badge[] {
  const badges: Badge[] = []
  if (isArchived(tenant)) {
    badges.push({ label: 'Archived', tone: 'grey' })
  } else if (!tenant.active) {
    badges.push({ label: 'Suspended', tone: 'red' })
    if (isPaying(tenant)) badges.push({ label: 'Paid - awaiting Resume', tone: 'green' })
    else badges.push({ label: 'Awaiting activation', tone: 'amber' })
  } else if (isPaying(tenant)) {
    badges.push({ label: 'Active', tone: 'green' })
  } else if (!tenant.isInternal) {
    badges.push({ label: 'No subscription', tone: 'amber' })
  } else {
    badges.push({ label: 'Active', tone: 'green' })
  }
  if (tenant.isInternal) badges.push({ label: 'Internal', tone: 'grey' })
  return badges
}

// Plan facts we really have: whether a Stripe subscription is stored. The
// plan name and price live in Stripe and are not on the tenant list.
export function planBadge(tenant: PlatformTenant): Badge | null {
  return tenant.hasStripeSubscription ? { label: 'Stripe subscription', tone: 'blue' } : null
}

export interface Issue {
  id: string
  severity: 'bad' | 'warn'
  text: string
}

function hoursSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / (60 * 60 * 1000))
}

export function tenantIssues(tenant: PlatformTenant, units: PiUnitSummary[], now: number): Issue[] {
  if (isArchived(tenant)) return []
  const issues: Issue[] = []
  if (isPaidAwaitingResume(tenant)) {
    issues.push({ id: 'paid-awaiting-resume', severity: 'bad', text: 'Paid, but still suspended. Payment never resumes a tenant, so Resume is a manual step.' })
  } else if (!tenant.active) {
    issues.push({ id: 'suspended', severity: 'bad', text: 'Suspended: the public dashboard is offline and the team can only manage their account and pay.' })
  }
  if (tenant.subscriptionStatus === 'past_due') {
    issues.push({ id: 'past-due', severity: 'bad', text: 'Payment failed (subscription is past due).' })
  }
  if (tenant.active && tenant.subscriptionStatus === 'cancelled') {
    issues.push({ id: 'cancelled-but-live', severity: 'warn', text: 'Subscription is cancelled but the tenant is still live.' })
  }
  if (tenant.active && !tenant.isInternal && !isPaying(tenant) && tenant.subscriptionStatus !== 'comped' && tenant.subscriptionStatus !== 'cancelled' && tenant.subscriptionStatus !== 'past_due') {
    issues.push({ id: 'no-subscription', severity: 'warn', text: 'No active Stripe subscription on a tenant that is not internal.' })
  }
  for (const unit of units) {
    if (!unit.tvScheduleLastSeenAt) continue
    const seen = new Date(unit.tvScheduleLastSeenAt).getTime()
    if (Number.isFinite(seen) && now - seen > PI_OFFLINE_ALERT_MS) {
      issues.push({ id: `pi-offline-${unit.id}`, severity: 'warn', text: `Linked Pi box ${unit.serialNumber} has not checked in for ${hoursSince(unit.tvScheduleLastSeenAt, now)} hours.` })
    }
  }
  return issues
}

export type FilterKey = 'all' | 'paying' | 'suspended' | 'attention' | 'internal' | 'none'

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Paying' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'internal', label: 'Internal' },
  { key: 'none', label: 'No subscription' },
]

export function matchesFilter(tenant: PlatformTenant, filter: FilterKey, units: PiUnitSummary[], now: number): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'paying':
      return isPaying(tenant)
    case 'suspended':
      return !tenant.active
    case 'attention':
      return tenantIssues(tenant, piUnitsForTenant(units, tenant.id), now).length > 0
    case 'internal':
      return tenant.isInternal
    case 'none':
      return !tenant.isInternal && !isPaying(tenant) && tenant.active
  }
}

export function filterCounts(tenants: PlatformTenant[], units: PiUnitSummary[], now: number): Record<FilterKey, number> {
  const counts: Record<FilterKey, number> = { all: 0, paying: 0, suspended: 0, attention: 0, internal: 0, none: 0 }
  for (const tenant of tenants) {
    for (const f of FILTERS) if (matchesFilter(tenant, f.key, units, now)) counts[f.key] += 1
  }
  return counts
}

// Search across name, slug, subdomain, member emails, the Media Box
// identifier and the serial of any linked Pi box. Every space-separated
// word must match somewhere.
export function searchText(tenant: PlatformTenant, units: PiUnitSummary[]): string {
  const parts = [tenant.name, tenant.slug, tenant.subdomain, tenant.mediaBoxIdentifier ?? '']
  for (const member of tenant.members) parts.push(member.email, member.name)
  for (const unit of units) parts.push(unit.serialNumber)
  return parts.join(' ').toLowerCase()
}

export function matchesSearch(tenant: PlatformTenant, query: string, units: PiUnitSummary[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = searchText(tenant, units)
  return words.every((word) => haystack.includes(word))
}

export const RECENT_TENANTS_KEY = 'aic.platformRecentTenants'
const RECENT_LIMIT = 6

export function readRecentTenants(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_TENANTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((slug): slug is string => typeof slug === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

export function rememberRecentTenant(slug: string): void {
  try {
    const next = [slug, ...readRecentTenants().filter((s) => s !== slug)].slice(0, RECENT_LIMIT)
    window.localStorage.setItem(RECENT_TENANTS_KEY, JSON.stringify(next))
  } catch {
    // Recents are a convenience; ignore storage being unavailable.
  }
}

export function tenantInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
