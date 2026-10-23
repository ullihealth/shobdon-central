import { useState } from 'react'
import { Link } from 'react-router-dom'
import { findPricingPlan, formatGBP } from '../../../config/pricing'
import PilotTickerSlotsEditor from '../PilotTickerSlotsEditor'
import {
  ActivationLinkSection,
  AfisoFrequencyEditor,
  CarouselBudgetEditor,
  DisplayControls,
  ForcePilotUpdateButton,
  HardDeleteSection,
  HistoryEntryRow,
  LogEveryoneOutButton,
  LogoEditor,
  MediaBoxIssuedEditor,
  MediaScreenEntitlementEditor,
  MembersSection,
  NameEditor,
  ParentAirfieldEditor,
  PrimaryCameraEditor,
  QnhQfeOffsetEditor,
  QrCaptionTextEditor,
  QrMockupEditor,
  QrTargetUrlEditor,
  QuotaEditor,
  RefreshDisplaysButton,
  SUBSCRIPTION_STATUS_OPTIONS,
  SettingsToggleRow,
  SubscriptionEditor,
  formatDate,
  formatDateTime,
  formatMb,
  type PlatformTenant,
} from './tenantEditors'
import { useTenants } from './TenantsContext'
import { Card, Fact, PiStateText, StatusBadge } from './TenantUi'
import {
  isArchived,
  isPaying,
  piState,
  piUnitsForTenant,
  planBadge,
  statusBadges,
  tenantIssues,
} from './tenantStatus'

export type TabKey = 'overview' | 'billing' | 'products' | 'weather' | 'devices' | 'members' | 'internal'

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'billing', label: 'Billing & plan' },
  { key: 'products', label: 'Products' },
  { key: 'weather', label: 'Weather & ops' },
  { key: 'devices', label: 'Displays & devices' },
  { key: 'members', label: 'Members' },
  { key: 'internal', label: 'Internal' },
]

export function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

interface TabProps {
  tenant: PlatformTenant
  parentName: string | null
  onParentChanged: (slug: string | null) => void
  onOpenTab: (tab: TabKey) => void
  onDeleted: () => void
}

const On = ({ value }: { value: boolean }) => (
  <span className={value ? 'text-emerald-300' : 'text-muted-400'}>{value ? 'On' : 'Off'}</span>
)

function billingLabel(tenant: PlatformTenant): string {
  return SUBSCRIPTION_STATUS_OPTIONS.find((o) => o.value === tenant.subscriptionStatus)?.label ?? tenant.subscriptionStatus
}

function OpenLink({ tab, onOpenTab }: { tab: TabKey; onOpenTab: (tab: TabKey) => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpenTab(tab)}
      className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500"
    >
      Open -&gt;
    </button>
  )
}

export function OverviewTab({ tenant, parentName, onOpenTab }: TabProps): JSX.Element {
  const { piUnits, now } = useTenants()
  const units = piUnitsForTenant(piUnits, tenant.id)
  const issues = tenantIssues(tenant, units, now)
  const cafeTv = tenant.displays.find((d) => d.slug === 'cafe-tv')
  const activeDisplays = tenant.displays.filter((d) => d.active).length
  const owner = tenant.members.find((m) => m.role === 'owner')

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Needs attention"
        className={`rounded-2xl border p-5 ${issues.length ? 'border-amber-400/40 bg-amber-950/30' : 'border-emerald-400/30 bg-emerald-950/20'}`}
      >
        <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-slate-100">
          {issues.length ? `Needs attention (${issues.length})` : 'Nothing needs attention'}
        </h3>
        {issues.length === 0 ? (
          <p className="text-sm text-emerald-200">No problems found in this tenant's billing, status or linked devices.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {issues.map((issue) => (
              <li key={issue.id} className={`text-sm ${issue.severity === 'bad' ? 'text-red-200' : 'text-amber-200'}`}>
                {issue.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Billing & plan">
          <dl>
            <Fact label="Status">
              <span className="flex flex-wrap justify-end gap-1">
                {statusBadges(tenant).map((badge) => (
                  <StatusBadge key={badge.label} badge={badge} />
                ))}
              </span>
            </Fact>
            <Fact label="Stripe subscription">{tenant.hasStripeSubscription ? 'Yes' : 'None'}</Fact>
            <Fact label="Billing record">{billingLabel(tenant)}</Fact>
            <Fact label="Media Box consent">{tenant.mediaBoxConsentAt ? formatDate(tenant.mediaBoxConsentAt) : 'Not given'}</Fact>
            <Fact label="Media Box">{tenant.mediaBoxIdentifier || 'None'}</Fact>
          </dl>
          <OpenLink tab="billing" onOpenTab={onOpenTab} />
        </Card>

        <Card title="Products">
          <dl>
            <Fact label="Reception Dashboard"><On value={tenant.dashboardEnabled} /></Fact>
            <Fact label="Pilot's App"><On value={tenant.mobileEnabled} /></Fact>
            <Fact label="Media Screen">{cafeTv ? <On value={cafeTv.entitled} /> : <span className="text-muted-400">No screen</span>}</Fact>
            <Fact label="Reserved slots"><On value={tenant.carouselBudgetEnabled} /></Fact>
            <Fact label="QR slide"><On value={tenant.qrSlideEnabled} /></Fact>
          </dl>
          <OpenLink tab="products" onOpenTab={onOpenTab} />
        </Card>

        <Card title="Weather & ops">
          <dl>
            <Fact label="Parent airfield">{parentName ?? 'Independent'}</Fact>
            <Fact label="Physical ATC">{tenant.hasPhysicalAtc ? 'Yes' : 'No'}</Fact>
            <Fact label="AFISO">{tenant.afisoOpen ? `Open${tenant.afisoFrequency ? ` ${tenant.afisoFrequency}` : ''}` : 'Closed'}</Fact>
            <Fact label="QNH/QFE offset">{tenant.qnhQfeOffsetHpa == null ? 'None' : `${tenant.qnhQfeOffsetHpa} hPa`}</Fact>
          </dl>
          <OpenLink tab="weather" onOpenTab={onOpenTab} />
        </Card>

        <Card title="Displays & devices">
          <dl>
            <Fact label="Displays active">{`${activeDisplays} of ${tenant.displays.length}`}</Fact>
            <Fact label="Buffering gate"><On value={tenant.fullBufferGateEnabled} /></Fact>
            <Fact label="Pi box">
              {units.length === 0 ? 'None linked' : units[0].serialNumber}
            </Fact>
            {units.length > 0 && (
              <Fact label="Last seen">
                <PiStateText state={piState(units[0], now)} />
              </Fact>
            )}
          </dl>
          <OpenLink tab="devices" onOpenTab={onOpenTab} />
        </Card>

        <Card title="Members">
          <dl>
            <Fact label="People">{tenant.members.length}</Fact>
            <Fact label="Owner">{owner?.email ?? 'None'}</Fact>
            <Fact label="Admins">{tenant.members.filter((m) => m.role === 'admin').length}</Fact>
          </dl>
          <OpenLink tab="members" onOpenTab={onOpenTab} />
        </Card>
      </div>
    </div>
  )
}

const HISTORY_PREVIEW = 5

export function BillingTab({ tenant }: TabProps): JSX.Element {
  const { refreshTenants, handleMediaBoxFieldsSaved } = useTenants()
  const [showAllHistory, setShowAllHistory] = useState(false)
  const archived = isArchived(tenant)
  const plan = planBadge(tenant)
  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Billing status"
        description="Set by hand ahead of full Stripe automation. Separate from Suspend/Resume and from per-display entitlement."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {statusBadges(tenant).map((badge) => (
            <StatusBadge key={badge.label} badge={badge} />
          ))}
          {plan && <StatusBadge badge={plan} />}
          {isPaying(tenant) && <span className="text-xs text-muted-400">Stripe subscription id stored and status active</span>}
        </div>
        <SubscriptionEditor tenant={tenant} onSaved={refreshTenants} />
        <div className="mt-4 flex flex-col gap-2">
          {tenant.subscriptionHistory.length === 0 ? (
            <span className="text-xs text-muted-500">No status changes recorded yet</span>
          ) : (
            <>
              {(showAllHistory ? tenant.subscriptionHistory : tenant.subscriptionHistory.slice(0, HISTORY_PREVIEW)).map((entry) => (
                <HistoryEntryRow key={entry.id} entry={entry} />
              ))}
              {tenant.subscriptionHistory.length > HISTORY_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="self-start text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500"
                >
                  {showAllHistory ? 'Show fewer' : `Show all ${tenant.subscriptionHistory.length} changes`}
                </button>
              )}
            </>
          )}
        </div>
      </Card>

      {!archived && (
        <Card title="Activation link" description="Create a one-off link so this tenant can pick a plan and pay.">
          <ActivationLinkSection tenant={tenant} />
        </Card>
      )}

      <Card title="Media Box loan">
        <p className="text-xs text-muted-400">
          Media Box consent:{' '}
          {tenant.mediaBoxConsentAt ? (
            <span className="font-semibold text-emerald-300">given {formatDateTime(tenant.mediaBoxConsentAt)}</span>
          ) : (
            <span className="font-semibold text-muted-300">not given</span>
          )}
        </p>
        <div className="mt-3">
          <MediaBoxIssuedEditor tenant={tenant} onSaved={(fields) => handleMediaBoxFieldsSaved(tenant.id, fields)} />
        </div>
      </Card>
    </div>
  )
}

export function ProductsTab({ tenant }: TabProps): JSX.Element {
  const store = useTenants()
  const toggle = (field: Parameters<typeof store.handleBooleanToggle>[1]) => (next: boolean) =>
    store.handleBooleanToggle(tenant, field, next)
  const cafeTvDisplay = tenant.displays.find((d) => d.slug === 'cafe-tv')
  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Reception Dashboard"
        description={`The TV/clubhouse screen - Airfield Pack, ${formatGBP(findPricingPlan('pack')?.priceGBP ?? 44)}/mo.`}
      >
        <div className="overflow-hidden rounded-xl border border-border/60">
          <SettingsToggleRow
            label="Reception Dashboard enabled"
            checked={tenant.dashboardEnabled}
            onChange={toggle('dashboardEnabled')}
            helper="Turns the TV/clubhouse screen on or off. Off shows a simple locked message on the live display and any named display (/, /d/main) instead of the real dashboard - the café screen is never affected by this."
          />
          <SettingsToggleRow
            label="Reserved AirfieldCentral slots + time budget"
            checked={tenant.carouselBudgetEnabled}
            onChange={toggle('carouselBudgetEnabled')}
            helper="Reserves 3 carousel slots for AirfieldCentral's own ad/marketing content, leaving the tenant's own slides a shared time budget (set below) for the rest."
          />
          <SettingsToggleRow
            label="QR slide enabled"
            checked={tenant.qrSlideEnabled}
            onChange={toggle('qrSlideEnabled')}
            helper="Adds a QR-code slide to the carousel that promotes the Pilot's App, using the target URL/caption/mockup image set below."
          />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <div>
            <CarouselBudgetEditor tenant={tenant} onSaved={(seconds) => store.handleCarouselBudgetSaved(tenant.id, seconds)} />
            <p className="mt-1 max-w-[200px] text-xs text-muted-400">How much time (MM:SS) the tenant's own slides share, once reserved slots are on.</p>
          </div>
          <div>
            <QrTargetUrlEditor tenant={tenant} onSaved={(url) => store.handleQrTargetUrlSaved(tenant.id, url)} />
            <p className="mt-1 max-w-[220px] text-xs text-muted-400">Where the QR slide's code links to.</p>
          </div>
          <div>
            <QrCaptionTextEditor tenant={tenant} onSaved={(text) => store.handleQrCaptionTextSaved(tenant.id, text)} />
            <p className="mt-1 max-w-[200px] text-xs text-muted-400">Caption shown under the QR code.</p>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-400">QR phone mockup</div>
            <QrMockupEditor tenant={tenant} onSaved={(url) => store.handleQrMockupSaved(tenant.id, url)} />
            <p className="mt-1 max-w-[200px] text-xs text-muted-400">Phone-mockup image shown alongside the QR code.</p>
          </div>
          <Link
            to={
              tenant.tenantType === 'venue_cafe'
                ? `/platform/cafe-carousel-owner-slots?tenantId=${tenant.id}`
                : `/platform/tenants/${tenant.id}/carousel-owner-slots`
            }
            className="inline-flex min-h-[44px] items-center rounded-lg border border-accent-sky-500/40 px-3 py-2 text-sm font-semibold text-accent-sky-400 transition hover:bg-accent-sky-500/10"
          >
            {tenant.tenantType === 'venue_cafe' ? 'Manage reserved slots →' : 'Manage reserved slots (5/8/12) →'}
          </Link>
        </div>
      </Card>

      <Card
        title="Pilot's App"
        description={`The branded mobile PWA at /pilot - ${formatGBP(findPricingPlan('pilotApp')?.priceGBP ?? 29.99)}/mo standalone, or included in the Airfield Pack.`}
      >
        <div className="overflow-hidden rounded-xl border border-border/60">
          <SettingsToggleRow
            label="Mobile Pilot View enabled"
            checked={tenant.mobileEnabled}
            onChange={toggle('mobileEnabled')}
            helper="The Pilot's App paywall flag itself. Off shows a locked teaser screen at /pilot instead of the real mobile app."
          />
        </div>
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <PrimaryCameraEditor tenant={tenant} />
        </div>
        <div className="mt-4">
          <PilotTickerSlotsEditor tenantId={tenant.id} />
          <p className="mt-1 text-xs text-muted-400">Configures the scrolling ticker shown at the bottom of the Pilot's App.</p>
        </div>
      </Card>

      <Card
        title="Media Screen"
        description={`The café/clubhouse add-on screen - ${formatGBP(findPricingPlan('mediaScreen')?.priceGBP ?? 29.99)}/mo, requires the Airfield Pack.`}
      >
        {cafeTvDisplay ? (
          <MediaScreenEntitlementEditor tenantId={tenant.id} display={cafeTvDisplay} onSaved={(displayId, patch) => store.handleDisplaySaved(tenant.id, displayId, patch)} />
        ) : (
          <span className="text-xs text-muted-400">No café/clubhouse screen display configured for this tenant yet.</span>
        )}
      </Card>
    </div>
  )
}

export function WeatherTab({ tenant, onParentChanged }: TabProps): JSX.Element {
  const store = useTenants()
  const toggle = (field: Parameters<typeof store.handleBooleanToggle>[1]) => (next: boolean) =>
    store.handleBooleanToggle(tenant, field, next)
  return (
    <div className="flex flex-col gap-4">
      <Card title="Parent airfield" description="Links this tenant to another tenant's weather, NOTAMs and runway data (a co-located club sharing one real station).">
        <ParentAirfieldEditor tenant={tenant} allTenants={store.tenants} onChanged={onParentChanged} />
      </Card>

      <Card title="Station and AFISO">
        <div className="overflow-hidden rounded-xl border border-border/60">
          <SettingsToggleRow
            label="Has physical ATC"
            checked={tenant.hasPhysicalAtc}
            onChange={toggle('hasPhysicalAtc')}
            helper="Offers this tenant's own live weather station as a weather source, on both the dashboard and the Pilot's App."
            warning="Only turn this on for an airfield with a real PC2/ATC station. Enabling it for a tenant with no physical station breaks their weather."
          />
          <SettingsToggleRow
            label="AFISO open"
            checked={tenant.afisoOpen}
            onChange={toggle('afisoOpen')}
            helper="Shows whether the AFISO (radio) service is currently open, on both the dashboard and the Pilot's App. Manual - nothing sets this automatically."
          />
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-6">
          <div>
            <AfisoFrequencyEditor tenant={tenant} onSaved={(frequency) => store.handleAfisoFrequencySaved(tenant.id, frequency)} />
            <p className="mt-1 max-w-[220px] text-xs text-muted-400">Radio frequency shown alongside the AFISO status.</p>
          </div>
          <div>
            <QnhQfeOffsetEditor tenant={tenant} onSaved={(offset) => store.handleQnhQfeOffsetSaved(tenant.id, offset)} />
            <p className="mt-1 max-w-[260px] text-xs text-muted-400">
              Fixed pressure-datum correction (hPa) between QNH and QFE, if this airfield's real station always differs by exactly this much. Leave blank otherwise.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function DevicesTab({ tenant }: TabProps): JSX.Element {
  const store = useTenants()
  const units = piUnitsForTenant(store.piUnits, tenant.id)
  return (
    <div className="flex flex-col gap-4">
      <Card title="Displays" description="Support/maintenance force-off, per display - independent of billing.">
        {tenant.displays.length === 0 ? (
          <span className="text-xs text-muted-400">No displays yet</span>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tenant.displays.map((display) => (
              <DisplayControls
                key={display.id}
                tenantId={tenant.id}
                display={display}
                onSaved={(displayId, patch) => store.handleDisplaySaved(tenant.id, displayId, patch)}
              />
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <RefreshDisplaysButton tenant={tenant} />
          <ForcePilotUpdateButton tenant={tenant} />
        </div>
      </Card>

      <Card title="Display behaviour">
        <div className="overflow-hidden rounded-xl border border-border/60">
          <SettingsToggleRow
            label="Full-screen buffering gate on public display"
            checked={tenant.fullBufferGateEnabled}
            onChange={(next) => store.handleBooleanToggle(tenant, 'fullBufferGateEnabled', next)}
            helper="Shows a brief 'buffering' screen before the display starts, so viewers never see a half-loaded carousel. Cosmetic only - safe to toggle any time."
          />
        </div>
      </Card>

      <Card title="Pi box" description="Boxes linked to this tenant in Pi Fleet.">
        {units.length === 0 ? (
          <p className="text-sm text-muted-300">No Pi box is linked to this tenant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {units.map((unit) => (
              <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <span className="font-semibold text-white">{unit.serialNumber}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted-400">{unit.status}</span>
                  <PiStateText state={piState(unit, store.now)} />
                  {unit.tvScheduleLastSeenAt && (
                    <span className="text-xs text-muted-400">last seen {formatDateTime(unit.tvScheduleLastSeenAt)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/platform/pi-fleet" className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          Open Pi Fleet →
        </Link>
      </Card>
    </div>
  )
}

export function MembersTab({ tenant }: TabProps): JSX.Element {
  const { refreshTenants } = useTenants()
  return (
    <div className="flex flex-col gap-4">
      <Card title="Members">
        <MembersSection tenant={tenant} onChanged={refreshTenants} />
      </Card>
      <Card title="Sessions" description="Revoke every active session of this tenant's non-developer members. Developers and other tenants' users are not affected.">
        <LogEveryoneOutButton tenant={tenant} />
      </Card>
    </div>
  )
}

export function InternalTab({ tenant, onDeleted }: TabProps): JSX.Element {
  const store = useTenants()
  const toggle = (field: Parameters<typeof store.handleBooleanToggle>[1]) => (next: boolean) =>
    store.handleBooleanToggle(tenant, field, next)
  return (
    <div className="flex flex-col gap-4">
      <Card title="Platform-internal" description="Not customer-facing - developer/support tools only.">
        <div className="overflow-hidden rounded-xl border border-border/60">
          <SettingsToggleRow
            label="Weather public"
            checked={tenant.weatherPublic}
            onChange={toggle('weatherPublic')}
            helper="Includes this tenant in an internal, not-yet-public cross-tenant data API. Has no effect on the tenant's own dashboard or Pilot's App."
          />
          <SettingsToggleRow
            label="Ops public"
            checked={tenant.opsPublic}
            onChange={toggle('opsPublic')}
            helper="Same, for NOTAMs/ops data. Has no effect on the tenant's own dashboard or Pilot's App."
          />
          <SettingsToggleRow
            label="Internal"
            checked={tenant.isInternal}
            onChange={toggle('isInternal')}
            helper="Marks this as an internal/test/template tenant (e.g. demo, newcustomer). Excludes it from the public tenant directory API above."
          />
          <SettingsToggleRow
            label="Show live dashboard link on /global"
            checked={tenant.globalLinkEnabled}
            onChange={toggle('globalLinkEnabled')}
            helper="Whether a 'View live dashboard' link appears on this tenant's card on the internal /global showcase page."
          />
        </div>
        <div className="mt-4">
          <QuotaEditor tenant={tenant} onSaved={(bytes) => store.handleQuotaSaved(tenant.id, bytes)} />
          <p className="mt-1 max-w-[260px] text-xs text-muted-400">
            Total media library storage (images/videos) this tenant can upload. In use: {formatMb(tenant.usedBytes)}.
          </p>
        </div>
      </Card>

      <Card title="Name and logo" description="Edited here, away from the header, so the name cannot be changed by accident.">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[220px] flex-1">
            <NameEditor tenant={tenant} onSaved={(name) => store.handleNameSaved(tenant.id, name)} />
          </div>
          <LogoEditor tenant={tenant} onSaved={(logoUrl) => store.handleLogoSaved(tenant.id, logoUrl)} />
        </div>
      </Card>

      {tenant.deletedAt && (
        <Card title="Archived tenant" description={`Archived ${formatDate(tenant.deletedAt)}. Suspend/Resume is unavailable while archived.`}>
          <HardDeleteSection tenant={tenant} onDeleted={onDeleted} />
        </Card>
      )}
    </div>
  )
}
