import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import Clubhouse1Template from '../components/displayTemplates/Clubhouse1Template'
import Clubhouse2Template from '../components/displayTemplates/Clubhouse2Template'
import TenantUnavailable from '../components/TenantUnavailable'
import { WeatherProvider } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'

// Thin dispatcher over the tenant's selected dashboard template - the
// actual layout JSX lives entirely in Clubhouse1Template.tsx (an exact,
// byte-for-byte extraction of what this file used to render inline,
// verified via before/after screenshot diff) and Clubhouse2Template.tsx.
// This file keeps only what's genuinely cross-template: the public config
// fetch, the unavailable/paused-tenant gate, and the WeatherProvider wrap -
// same shape TenantDisplayPage.tsx already uses to dispatch between
// ClassicTemplate/CafeTvTemplate for /d/:slug.
export default function DashboardPage(): JSX.Element {
  // Active theme, synced across every device via the tenant-scoped D1
  // config (was the Worker's global theme KV key - see
  // functions/api/public/[tenant]/config.ts). Absent a fetched override,
  // the committed :root defaults apply naturally - no fallback object
  // needed here, since :root already equals CURRENT_LIVE_THEME. No auth
  // on this fetch deliberately - this is the live public dashboard,
  // unauthenticated for everyone, same as today.
  const [themeOverride, setThemeOverride] = useState<CSSProperties>({})
  // Real tenant name (tenants.name, via config.ts's airfieldName field) -
  // null until the fetch resolves, same "brief blank rather than another
  // tenant's real name" stance Header.tsx's own fallback takes.
  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  // Uploaded tenant logo (tenants.logo_r2_key, resolved by publicConfig.ts).
  // Same null-until-fetched stance as airfieldName above.
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  // Which template renders at "/" for this tenant (tenant_displays 'main'
  // row's template_id, resolved server-side in publicConfig.ts - never
  // missing/null in the response itself, always at least 'classic').
  const [mainTemplateId, setMainTemplateId] = useState('classic')
  // Set only on a genuine resolution failure (config.ts 404s - unknown
  // host, or the tenant is paused: tenants.active = 0, see
  // resolveTenantHost.ts). A transient network hiccup that still
  // resolves fine next poll doesn't belong here - this fetch runs once
  // on mount, not on an interval, so "unavailable" reflects the actual
  // resolution outcome, not a one-off blip.
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch(PUBLIC_CONFIG_URL)
      .then((response) => {
        if (!response.ok) {
          if (!cancelled) setUnavailable(true)
          return null
        }
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        if (data?.theme) setThemeOverride(data.theme as CSSProperties)
        if (data?.airfieldName) {
          setAirfieldName(data.airfieldName as string)
          // Browser tab title - was a static "Shobdon Central" literal in
          // index.html, same hardcode class as Header's, just less visually
          // prominent (a kiosk TV has no tab bar; a laptop/tablet browser
          // does). Set once real data arrives rather than left permanently
          // wrong for every other tenant.
          document.title = `${data.airfieldName} — Airfield Central`
        }
        if (data?.logoUrl) setLogoUrl(data.logoUrl as string)
        if (data?.mainTemplateId) setMainTemplateId(data.mainTemplateId as string)
      })
      .catch(() => {
        // Network failure, not a resolution failure - fall through to
        // the committed :root defaults rather than showing "unavailable"
        // for what might just be a dropped request.
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (unavailable) return <TenantUnavailable />

  return (
    <WeatherProvider>
      {mainTemplateId === 'clubhouse-2' ? (
        <Clubhouse2Template themeOverride={themeOverride} airfieldName={airfieldName} logoUrl={logoUrl} />
      ) : (
        <Clubhouse1Template themeOverride={themeOverride} airfieldName={airfieldName} logoUrl={logoUrl} />
      )}
    </WeatherProvider>
  )
}
