import { useEffect, useRef, useState } from 'react'

// Pilot View - dependency-free pull-to-refresh, attached to the page's
// own scroll container (document in practice, since PilotViewPage.tsx
// uses natural document scroll rather than an inner scrollable div).
// Only arms when the container is already scrolled to the very top at
// touch-start (the standard "already at the top" gate every native
// pull-to-refresh implementation uses) - a mid-page swipe never
// triggers it. No native browser API beyond TouchEvent, so this stays
// safe inside a future WebView wrapper.
const REFRESH_THRESHOLD_PX = 80

export function usePullToRefresh(onRefresh: () => void): { pulling: boolean; pullDistance: number } {
  const [pulling, setPulling] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startYRef = useRef<number | null>(null)
  const armedRef = useRef(false)

  useEffect(() => {
    function getScrollTop(): number {
      return window.scrollY || document.documentElement.scrollTop || 0
    }

    function handleTouchStart(event: TouchEvent) {
      if (getScrollTop() > 0) {
        startYRef.current = null
        return
      }
      startYRef.current = event.touches[0]?.clientY ?? null
    }

    function handleTouchMove(event: TouchEvent) {
      if (startYRef.current === null) return
      // Once the page has scrolled away from the top mid-gesture, stop
      // tracking - the user is now genuinely scrolling, not pulling.
      if (getScrollTop() > 0) {
        startYRef.current = null
        setPulling(false)
        setPullDistance(0)
        return
      }
      const currentY = event.touches[0]?.clientY ?? 0
      const delta = currentY - startYRef.current
      if (delta <= 0) {
        setPulling(false)
        setPullDistance(0)
        armedRef.current = false
        return
      }
      setPulling(true)
      setPullDistance(delta)
      armedRef.current = delta > REFRESH_THRESHOLD_PX
    }

    function handleTouchEnd() {
      if (armedRef.current) onRefresh()
      startYRef.current = null
      armedRef.current = false
      setPulling(false)
      setPullDistance(0)
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [onRefresh])

  return { pulling, pullDistance }
}
