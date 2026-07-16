import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import CafeTvTemplate from '../components/displayTemplates/CafeTvTemplate'
import ClassicTemplate from '../components/displayTemplates/ClassicTemplate'
import { DEFAULT_PANEL_CONFIG, normalizePanelConfig, type DisplayPanelConfig } from '../components/displayTemplates/panelConfig'
import { WeatherProvider } from '../context/WeatherContext'
import { PUBLIC_CONFIG_URL } from '../config/publicApi'

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

  const [themeOverride, setThemeOverride] = useState<CSSProperties>({})
  const [display, setDisplay] = useState<DisplayMeta>({ templateId: 'classic', panelConfig: DEFAULT_PANEL_CONFIG })
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.theme) setThemeOverride(data.theme as CSSProperties)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setNotFound(false)
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
        if (!cancelled) setNotFound(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (notFound) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
        No display named &ldquo;{slug}&rdquo; for this airfield.
      </div>
    )
  }

  return (
    <WeatherProvider>
      {display.templateId === 'cafe-tv' ? (
        <CafeTvTemplate panelConfig={display.panelConfig} themeOverride={themeOverride} />
      ) : (
        <ClassicTemplate panelConfig={display.panelConfig} themeOverride={themeOverride} />
      )}
    </WeatherProvider>
  )
}
