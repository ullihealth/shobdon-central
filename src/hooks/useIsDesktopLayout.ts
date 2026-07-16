import { useEffect, useState } from 'react'

const DESKTOP_QUERY = '(min-width: 768px)'

// Shared by every fixed-viewport dashboard layout (DashboardPage,
// CentreDisplayPanel, the tenant_displays template components) that
// needs to switch between a JS-computed inline grid/flex style
// (desktop, fr-based columns) and a stacked mobile layout - a static
// Tailwind breakpoint class can't express the desktop side since those
// values are computed at runtime, so matchMedia is the reliable way to
// pick between the two style objects.
export function useIsDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(DESKTOP_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY)
    const handleChange = () => setIsDesktop(mql.matches)
    handleChange()
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return isDesktop
}
