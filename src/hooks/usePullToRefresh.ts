import { useEffect, useRef, useState } from 'react'

// Pilot View - dependency-free pull-to-refresh, attached to the page's
// own scroll container (document in practice, since PilotViewPage.tsx
// uses natural document scroll rather than an inner scrollable div).
// Only arms when the container is already scrolled to the very top at
// touch-start (the standard "already at the top" gate every native
// pull-to-refresh implementation uses) - a mid-page swipe never
// triggers it. No native browser API beyond TouchEvent, so this stays
// safe inside a future WebView wrapper.
//
// Exported (not module-private) so PilotViewPage.tsx's own arrow-flip/
// "Release to refresh" copy compares against this exact same value
// instead of a second hardcoded copy of the number - the two drifting
// out of sync was a real, if harmless, risk with the old unexported
// constant.
export const REFRESH_THRESHOLD_PX = 150
// Applied to the raw finger-drag distance before it becomes the
// pullDistance state below - was a flat 1:1 (no damping at all), which
// is the actual reason the old 80px threshold felt twitchy: with zero
// resistance curve, a short, fast flick crossed it instantly, and a
// finger wobbling near that exact boundary could flip the armed state
// back and forth with nothing smoothing it out. At 0.5, the visual
// indicator moves at half the finger's speed, so reaching the 150px
// threshold above now takes ~300px of actual physical travel - a
// genuinely deliberate swipe - and the halved sensitivity itself damps
// out small near-threshold jitter as a side effect, not just the higher
// threshold alone.
const PULL_DAMPING_FACTOR = 0.5

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
      // Real bug, not just a nicety: without this, real iOS Safari (most
      // visible in home-screen standalone mode) is free to treat this same
      // downward drag as its own native elastic-overscroll gesture. Once
      // WebKit's gesture recogniser decides that's what's happening, it
      // terminates the touch sequence with `touchcancel` instead of
      // `touchend` - which this hook had no listener for at all, so
      // armedRef's state was simply never checked and onRefresh() never
      // ran. Confirmed this hook's own logic was otherwise correct (a
      // simulated drag via CDP touch events fired onRefresh reliably) -
      // this preventDefault is what stops WebKit from ever taking the
      // gesture away from us on a real device in the first place, so
      // touchend (not touchcancel) is what actually ends the sequence.
      // Deliberately called only in this branch - normal scrolling
      // (delta <= 0, or already scrolled past the top) is never touched,
      // so this can't block real scroll gestures anywhere on the page.
      event.preventDefault()
      const dampedDistance = delta * PULL_DAMPING_FACTOR
      setPulling(true)
      setPullDistance(dampedDistance)
      armedRef.current = dampedDistance > REFRESH_THRESHOLD_PX
    }

    function handleTouchEnd() {
      if (armedRef.current) onRefresh()
      startYRef.current = null
      armedRef.current = false
      setPulling(false)
      setPullDistance(0)
    }

    // Safety net, not the primary fix (the preventDefault above is what
    // actually stops this from happening on a real device) - if a touch
    // sequence is ever interrupted for some other reason (an incoming
    // call, a multi-touch gesture, etc.), this resets state cleanly
    // without firing onRefresh, the same as an upward flick already does,
    // rather than leaving armedRef/startYRef stuck for the next gesture.
    function handleTouchCancel() {
      startYRef.current = null
      armedRef.current = false
      setPulling(false)
      setPullDistance(0)
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    // Not passive - handleTouchMove needs to call preventDefault() while
    // actively tracking a pull, which a passive listener can never do.
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchCancel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [onRefresh])

  return { pulling, pullDistance }
}
