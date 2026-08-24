import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import Clubhouse1Template from '../components/displayTemplates/Clubhouse1Template'
import Clubhouse2Template from '../components/displayTemplates/Clubhouse2Template'
import CafeTemplate from '../components/displayTemplates/CafeTemplate'
import TenantUnavailable from '../components/TenantUnavailable'
import DashboardLoading from '../components/DashboardLoading'
import FullBufferGate from '../components/FullBufferGate'
import { isTrackedMediaType, type GateAsset } from '../hooks/useVideoDownloadStates'
import { WeatherProvider } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { useDisplayHeartbeat } from '../hooks/useDisplayHeartbeat'

// Thin dispatcher over the tenant's selected dashboard template - the
// actual layout JSX lives entirely in Clubhouse1Template.tsx (an exact,
// byte-for-byte extraction of what this file used to render inline,
// verified via before/after screenshot diff) and Clubhouse2Template.tsx.
// This file keeps only what's genuinely cross-template: the public config
// fetch, the unavailable/paused-tenant gate, and the WeatherProvider wrap -
// same shape TenantDisplayPage.tsx already uses to dispatch between
// ClassicTemplate/CafeTemplate for /d/:slug.
export default function DashboardPage(): JSX.Element {
  // display_visits heartbeat (migration 0041) - slug 'main' since this is
  // the '/' dashboard, matching the tenant_displays 'main' row this same
  // page's own config fetch already resolves against.
  useDisplayHeartbeat('main')
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
  // Migration 0039 (Screens Design's Branding tab) - null until the
  // fetch resolves, same stance as airfieldName/logoUrl above. Header.tsx/
  // VenueCornerBadge.tsx both default every one of these props to
  // true/true/'md' on their own, so passing undefined (the null case
  // here) during the brief pre-fetch window is already exactly today's
  // unconditional behaviour, not a separate fallback to maintain.
  const [brandDisplay, setBrandDisplay] = useState<{
    main: { showLogo: boolean; showName: boolean; nameFontSize: 'sm' | 'md' | 'lg' | 'xl' }
    cafe: { showLogo: boolean; showName: boolean; nameFontSize: 'sm' | 'md' | 'lg' | 'xl' }
  } | null>(null)
  // Set only on a genuine resolution failure (config.ts 404s - unknown
  // host, or the tenant is paused: tenants.active = 0, see
  // resolveTenantHost.ts). A transient network hiccup that still
  // resolves fine next poll doesn't belong here - this fetch runs once
  // on mount, not on an interval, so "unavailable" reflects the actual
  // resolution outcome, not a one-off blip.
  const [unavailable, setUnavailable] = useState(false)
  // Root-path café fallback (publicConfig.ts's cafeDisplayActive) - a
  // venue_cafe tenant has main deliberately inactive (café is their only
  // real screen), so "/" showing TenantUnavailable for them would be
  // wrong, not correct-but-unfortunate. Only ever consulted when
  // mainDisplayActive is false; an airfield tenant with main on is
  // completely unaffected regardless of this value.
  const [cafeFallbackActive, setCafeFallbackActive] = useState(false)
  // Byte-verified buffering gate round (migration 0094) - per-tenant
  // opt-in whole-page gate flag, and every slot (in rotation order,
  // as GateAssets - see that type's own comment) belonging to whichever
  // carousel this page will actually render (café's, if this tenant
  // falls back to or is configured for it; the main carousel otherwise)
  // - see the computation below for why this has to be derived at
  // fetch time rather than read from carouselSlots/cafeCarouselSlots
  // directly, since which one applies depends on cafeFallbackActive/
  // mainTemplateId, both resolved in the very same fetch.
  const [fullBufferGateEnabled, setFullBufferGateEnabled] = useState(false)
  const [gateAssets, setGateAssets] = useState<GateAsset[]>([])
  // Gates rendering any real template until the config fetch settles
  // (success, failure, or network error - all three via .finally below)
  // - without this, the brief pre-fetch window rendered Clubhouse1Template
  // with its own unresolved defaults (null airfieldName, mock weather),
  // which reads as a real, wrong dashboard rather than a loading state.
  // Applies to every tenant type identically, not just venue_cafe - an
  // airfield tenant never visibly notices since Clubhouse1Template is
  // also its correct final template, but the flash was happening for it
  // too the whole time.
  const [loaded, setLoaded] = useState(false)

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
        if (data?.brandDisplay) setBrandDisplay(data.brandDisplay)
        // Part D developer override (migration 0034) - a support/
        // maintenance force-off for '/' itself, independent of both
        // tenants.active (whole-tenant pause, handled by the !response.ok
        // branch above) and café entitlement (which only ever gates
        // /d/cafe-tv, not this main dashboard). Same clean-unavailable
        // outcome either way - see TenantUnavailable's own comment on
        // deliberately not distinguishing the reason.
        let willUseCafeCarousel = false
        if (data?.mainDisplayActive === false) {
          if (data?.cafeDisplayActive) {
            setCafeFallbackActive(true)
            willUseCafeCarousel = true
          } else {
            setUnavailable(true)
          }
        }
        if (data?.mainTemplateId === 'cafe-1') willUseCafeCarousel = true
        setFullBufferGateEnabled(!!data?.fullBufferGateEnabled)
        const rawGateSlots = willUseCafeCarousel ? data?.cafeCarouselSlots : data?.carouselSlots
        setGateAssets(
          Array.isArray(rawGateSlots)
            ? rawGateSlots.map((slot: { mediaType?: string; resolvedUrl?: string | null; mediaSizeBytes?: number | null }) => ({
                url: slot?.mediaType && isTrackedMediaType(slot.mediaType) ? slot?.resolvedUrl ?? null : null,
                sizeBytes: slot?.mediaSizeBytes ?? null,
              }))
            : []
        )
      })
      .catch(() => {
        // Network failure, not a resolution failure - fall through to
        // the committed :root defaults rather than showing "unavailable"
        // for what might just be a dropped request.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (unavailable) return <TenantUnavailable />
  if (!loaded) return <DashboardLoading />

  return (
    <WeatherProvider>
      <FullBufferGate enabled={fullBufferGateEnabled} assets={gateAssets} airfieldName={airfieldName} logoUrl={logoUrl}>
        {cafeFallbackActive ? (
          <CafeTemplate
            themeOverride={themeOverride}
            airfieldName={airfieldName}
            logoUrl={logoUrl}
            showLogo={brandDisplay?.cafe.showLogo}
            showName={brandDisplay?.cafe.showName}
            nameFontSize={brandDisplay?.cafe.nameFontSize}
          />
        ) : mainTemplateId === 'clubhouse-2' ? (
          <Clubhouse2Template
            themeOverride={themeOverride}
            airfieldName={airfieldName}
            logoUrl={logoUrl}
            showLogo={brandDisplay?.main.showLogo}
            showName={brandDisplay?.main.showName}
            nameFontSize={brandDisplay?.main.nameFontSize}
          />
        ) : mainTemplateId === 'cafe-1' ? (
          <CafeTemplate
            themeOverride={themeOverride}
            airfieldName={airfieldName}
            logoUrl={logoUrl}
            showLogo={brandDisplay?.cafe.showLogo}
            showName={brandDisplay?.cafe.showName}
            nameFontSize={brandDisplay?.cafe.nameFontSize}
          />
        ) : (
          <Clubhouse1Template
            themeOverride={themeOverride}
            airfieldName={airfieldName}
            logoUrl={logoUrl}
            showLogo={brandDisplay?.main.showLogo}
            showName={brandDisplay?.main.showName}
            nameFontSize={brandDisplay?.main.nameFontSize}
          />
        )}
      </FullBufferGate>
    </WeatherProvider>
  )
}
