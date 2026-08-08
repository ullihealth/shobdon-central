import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AirfieldLocationSection from '../components/config/AirfieldLocationSection'
import WeatherSourceSelector from '../components/config/WeatherSourceSelector'
import AtcWeatherConfigSection from '../components/config/AtcWeatherConfigSection'
import IngestedWeatherConfigSection from '../components/config/IngestedWeatherConfigSection'
import InternetWeatherConfigSection from '../components/config/InternetWeatherConfigSection'
import MockWeatherConfigSection from '../components/config/MockWeatherConfigSection'
import PC2CaptureSetup from '../components/config/PC2CaptureSetup'
import StorageUsage from '../components/config/StorageUsage'
import { TENANT_CONFIG_URL } from '../config/publicApi'
import { loadWeatherConfig, resolveWeatherConfig, saveWeatherConfig } from '../services/weatherConfigStore'
import type { WeatherConfig, WeatherProviderId } from '../types/weatherConfig'

export default function ConfigPage(): JSX.Element {
  // Starts with the synchronous local value (unchanged, no blank flash),
  // then - only if nothing was actually stored yet - resolves to this
  // tenant's own server-side default instead of staying on the
  // hardcoded 'mock' + Shobdon-coordinates fallback. An already-
  // configured device (Shobdon's own kiosks/PC2 flow) has a stored
  // value, so resolveWeatherConfig() just returns it unchanged here too
  // - this is a no-op for them, not a behaviour change.
  const [config, setConfig] = useState<WeatherConfig>(() => loadWeatherConfig())

  // Starts false (not null) so a tenant without ATC hardware never gets
  // even a brief flash of the PC2 setup section/checklist link/weather
  // "atc" option while this loads - fails closed, matching the same
  // "hide unless confirmed relevant" posture as the provider-specific
  // weather sections below. Shobdon (true) pops the section in once the
  // fetch resolves, same one-render-late pattern config itself already
  // has via resolveWeatherConfig().
  const [hasPhysicalAtc, setHasPhysicalAtc] = useState(false)

  // Per-tenant override (migration 0083, internet_provider_display_name)
  // for how the Open-Meteo provider is named in this page's own dropdown
  // (InternetWeatherConfigSection.tsx below) - read-only here (no PUT
  // support, developer-set via direct D1 only, see that migration's own
  // comment). null/not-yet-loaded is fine as the initial value - the
  // dropdown falls back to the registry's own generic "Open-Meteo" label
  // exactly like before this override existed.
  const [internetProviderDisplayName, setInternetProviderDisplayName] = useState<string | null>(null)

  // tenants.parent_tenant_id (migration 0059, renamed from
  // tenant_weather_shares/migration 0029 - see functions/api/tenant/
  // parent-tenant.ts's own comment for the full "why") -
  // platform-admin-configured only (functions/api/platform/tenants/
  // [id]/parent-tenant.ts owns the write side), previously invisible
  // anywhere on this tenant's own pages - a tenant had no way to learn
  // this was set except asking. null covers both "still loading" and
  // "no parent linked", same "render nothing rather than an empty
  // state" convention as this page's own hasPhysicalAtc sections below.
  // Banner wording deliberately unchanged by the rename - only the
  // fetch URL/field name underneath it moved.
  const [weatherShare, setWeatherShare] = useState<{ sourceTenantName: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/parent-tenant')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.parentTenantName) setWeatherShare({ sourceTenantName: data.parentTenantName })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    resolveWeatherConfig().then((resolved) => {
      if (!cancelled) setConfig(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(TENANT_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setHasPhysicalAtc(!!data.hasPhysicalAtc)
          if (typeof data.internetProviderDisplayName === 'string' && data.internetProviderDisplayName.trim()) {
            setInternetProviderDisplayName(data.internetProviderDisplayName.trim())
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function updateConfig(next: WeatherConfig) {
    setConfig(next)
    saveWeatherConfig(next)
  }

  // The one field on this page with a real server column (migration
  // 0082, tenants.active_weather_provider) - every other updateConfig()
  // caller below (atc/internet connection settings) stays exactly as it
  // was, localStorage-only, since only the PROVIDER CHOICE ITSELF needs
  // to be shared across devices, not each provider's own per-device
  // connection details. saveWeatherConfig (inside updateConfig above)
  // still runs first, so this device's own UI/behaviour updates
  // immediately regardless of whether the network write below succeeds;
  // the PUT is what makes every OTHER device see the same choice on its
  // own next refresh. Fire-and-forget by design - WeatherSourceSelector
  // is an immediate-effect control with no separate "Save" button/state,
  // same posture updateConfig already has for every other field here; a
  // failed write just means other devices won't see this change until
  // it's retried or reselected, not a broken local experience.
  function handleSourceChange(activeProvider: WeatherProviderId) {
    updateConfig({ ...config, activeProvider })
    fetch(TENANT_CONFIG_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeWeatherProvider: activeProvider }),
    })
      .then((response) => {
        if (!response.ok) console.warn('Failed to save weather provider selection server-side:', response.status)
      })
      .catch((error) => {
        console.warn('Failed to save weather provider selection server-side:', error)
      })
  }

  return (
    // Was mx-auto max-w-3xl wrapping a single narrow card, regardless of
    // viewport width - on a real desktop browser that left most of the
    // screen empty. max-w-7xl + a 2-column grid below use the space this
    // page's own AdminLayout.tsx shell (flex-1 main, sidebar already
    // accounted for) actually has, and fall back to a single stacked
    // column under lg (matching the old layout) rather than ever
    // squeezing these two independent cards to fit a fixed width.
    <div className="mx-auto max-w-7xl px-6 pb-10 pt-10">
      {/* Not part of the sidebar - /checklist is a public, non-role-gated
          route (no RequireAuth), so it doesn't belong in the authenticated
          admin nav. Kept reachable here as page content instead. Omitted
          entirely (not shown as a disabled link) for a tenant with no
          physical ATC hardware - there's nothing behind it to check. */}
      {hasPhysicalAtc && (
        <div className="mb-6">
          <Link
            to="/checklist"
            className="inline-block rounded-lg border border-border bg-panel px-4 py-2 text-sm font-semibold text-primary transition hover:border-accent-sky-500 hover:text-accent-sky-400"
          >
            📋 ATC Visit Checklist
          </Link>
        </div>
      )}

      {/* Read-only - the earlier decision to keep weather-sharing
          platform-admin-only stands (see functions/api/tenant/weather-
          share.ts's own comment), this is purely informational. Shown
          regardless of which provider is currently selected below
          (Third-Party Station is the one an active share actually
          overrides - functions/api/public/weather-latest.ts - but the
          share itself is a standing fact independent of what this
          tenant's own activeProvider happens to be set to right now). */}
      {weatherShare && (
        <div className="mb-6 rounded-2xl border border-accent-sky-500/30 bg-accent-sky-500/10 px-6 py-4 text-sm text-slate-200">
          Currently using <span className="font-semibold text-accent-sky-400">{weatherShare.sourceTenantName}</span>&apos;s
          weather station — configured by your platform administrator.
        </div>
      )}

      {/* Weather Source and the active provider's own settings are
          independent concerns (which source vs. that source's connection
          details) - side by side on a wide screen instead of stacked in
          one column, same content/behaviour as before either way. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
          <WeatherSourceSelector value={config.activeProvider} onChange={handleSourceChange} hasPhysicalAtc={hasPhysicalAtc} />
        </div>

        <div className="rounded-3xl border border-border bg-panel p-8 shadow-xl shadow-slate-950/20">
          {config.activeProvider === 'atc' && (
            <AtcWeatherConfigSection config={config.atc} onChange={(atc) => updateConfig({ ...config, atc })} />
          )}
          {config.activeProvider === 'internet' && (
            <InternetWeatherConfigSection
              config={config.internet}
              onChange={(internet) => updateConfig({ ...config, internet })}
              openMeteoDisplayName={internetProviderDisplayName}
            />
          )}
          {config.activeProvider === 'ingested' && <IngestedWeatherConfigSection />}
          {config.activeProvider === 'mock' && <MockWeatherConfigSection />}
        </div>
      </div>

      <div className="mt-6">
        <AirfieldLocationSection />
      </div>

      {/* Omitted entirely (no placeholder) for a tenant with no physical
          ATC hardware - matches this page's own existing convention of
          only rendering the sections that apply (see the weather
          provider sections above, which already do the same). */}
      {hasPhysicalAtc && (
        <div className="mt-6">
          <PC2CaptureSetup />
        </div>
      )}

      <div className="mt-6">
        <StorageUsage />
      </div>
    </div>
  )
}
