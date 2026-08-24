import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import CafeTemplate from '../components/displayTemplates/CafeTemplate'
import ClassicTemplate from '../components/displayTemplates/ClassicTemplate'
import { DEFAULT_PANEL_CONFIG, normalizePanelConfig, type DisplayPanelConfig } from '../components/displayTemplates/panelConfig'
import TenantUnavailable from '../components/TenantUnavailable'
import FullBufferGate from '../components/FullBufferGate'
import { WeatherProvider } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'
import { useDisplayHeartbeat } from '../hooks/useDisplayHeartbeat'

interface GateCarouselSlot {
  mediaType?: string
  resolvedUrl?: string | null
}

interface DisplayMeta {
  templateId: string
  panelConfig: DisplayPanelConfig
}

// Named per-tenant display route (tenant_displays, migration 0027) -
// /d/:displaySlug. Tenant is still resolved server-side from the Host
// header exactly as '/' (DashboardPage.tsx, untouched by this feature)
// already does - this route only adds a second axis (which named
// display, on top of which tenant) via /api/public/display. Every
// existing bookmarked/embedded '/' dashboard URL is unaffected: this is
// an additional route, not a replacement for the existing one.
export default function TenantDisplayPage(): JSX.Element {
  const { displaySlug } = useParams<{ displaySlug: string }>()
  const slug = displaySlug || 'main'

  // display_visits heartbeat (migration 0041) - same slug this page
  // already resolves its own display metadata against, so a visit here
  // logs under the actual named display, not lumped under 'main'.
  useDisplayHeartbeat(slug)

  const [themeOverride, setThemeOverride] = useState<CSSProperties>({})
  const [airfieldName, setAirfieldName] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [display, setDisplay] = useState<DisplayMeta>({ templateId: 'classic', panelConfig: DEFAULT_PANEL_CONFIG })
  const [unavailable, setUnavailable] = useState(false)
  // Migration 0039 (Screens Design's Branding tab) - null until the
  // fetch resolves, same stance as airfieldName/logoUrl above. Header.tsx/
  // VenueCornerBadge.tsx both default every one of these props to
  // true/true/'md' on their own, so undefined during the brief
  // pre-fetch window is already exactly today's unconditional behaviour.
  const [brandDisplay, setBrandDisplay] = useState<{
    main: { showLogo: boolean; showName: boolean; nameFontSize: 'sm' | 'md' | 'lg' | 'xl' }
    cafe: { showLogo: boolean; showName: boolean; nameFontSize: 'sm' | 'md' | 'lg' | 'xl' }
  } | null>(null)
  // Byte-verified buffering gate round (migration 0094) - raw slot
  // arrays kept as fetched (not yet filtered to mp4/resolvedUrl-only),
  // since which one actually applies depends on display.templateId,
  // resolved by a SEPARATE fetch below (/api/public/display) that can
  // settle before or after this one - gateVideoUrls (further down)
  // derives the final answer once both are available, rather than
  // trying to pick the right array eagerly inside just one of the two
  // fetch callbacks.
  const [fullBufferGateEnabled, setFullBufferGateEnabled] = useState(false)
  const [carouselSlotsRaw, setCarouselSlotsRaw] = useState<GateCarouselSlot[]>([])
  const [cafeCarouselSlotsRaw, setCafeCarouselSlotsRaw] = useState<GateCarouselSlot[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.theme) setThemeOverride(data.theme as CSSProperties)
        if (data?.airfieldName) {
          setAirfieldName(data.airfieldName as string)
          document.title = `${data.airfieldName} — Airfield Central`
        }
        if (data?.logoUrl) setLogoUrl(data.logoUrl as string)
        if (data?.brandDisplay) setBrandDisplay(data.brandDisplay)
        setFullBufferGateEnabled(!!data?.fullBufferGateEnabled)
        setCarouselSlotsRaw(Array.isArray(data?.carouselSlots) ? data.carouselSlots : [])
        setCafeCarouselSlotsRaw(Array.isArray(data?.cafeCarouselSlots) ? data.cafeCarouselSlots : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const gateVideoUrls = useMemo(() => {
    const rawSlots = display.templateId === 'cafe-1' ? cafeCarouselSlotsRaw : carouselSlotsRaw
    return rawSlots
      .filter((slot) => slot?.mediaType === 'mp4' && !!slot?.resolvedUrl)
      .map((slot) => slot.resolvedUrl as string)
  }, [display.templateId, carouselSlotsRaw, cafeCarouselSlotsRaw])

  useEffect(() => {
    let cancelled = false
    setUnavailable(false)
    fetch(`/api/public/display?slug=${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('not found'))))
      .then((data) => {
        if (cancelled) return
        setDisplay({
          templateId: typeof data?.templateId === 'string' ? data.templateId : 'classic',
          panelConfig: normalizePanelConfig(data?.panelConfig),
        })
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  // Covers both an unknown display slug AND a paused tenant
  // (tenants.active = 0 makes resolveTenantFromHost - and therefore
  // /api/public/display - 404 the same way an unrecognised host does,
  // see resolveTenantHost.ts) - both get the identical clean message
  // rather than a slug-specific one that would be misleading for the
  // "whole tenant is paused" case.
  if (unavailable) return <TenantUnavailable />

  return (
    <WeatherProvider>
      <FullBufferGate enabled={fullBufferGateEnabled} videoUrls={gateVideoUrls} airfieldName={airfieldName} logoUrl={logoUrl}>
        {display.templateId === 'cafe-1' ? (
          <CafeTemplate
            themeOverride={themeOverride}
            airfieldName={airfieldName}
            logoUrl={logoUrl}
            showLogo={brandDisplay?.cafe.showLogo}
            showName={brandDisplay?.cafe.showName}
            nameFontSize={brandDisplay?.cafe.nameFontSize}
          />
        ) : (
          <ClassicTemplate
            panelConfig={display.panelConfig}
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
