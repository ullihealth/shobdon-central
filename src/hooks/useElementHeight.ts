import { useCallback, useRef, useState } from 'react'

// Generic - reports a DOM element's actual current rendered height (via
// ResizeObserver, not a value computed from its constituent props/state)
// so a sibling can reserve exactly that much space, whatever it turns
// out to be. Built for Clubhouse1Template.tsx/Clubhouse2Template.tsx/
// ClassicTemplate.tsx's own bottom "Powered by" + FooterTicker stack
// (and CafeTemplate.tsx's own ticker overlay) - that stack is
// position:absolute (so the panels grid above it has no natural
// awareness of its height at all), and its real height varies with
// both the tenant's configured ticker Height AND whether the ticker is
// even enabled - measuring the actual rendered box directly is the only
// way to stay correct across every combination without duplicating
// that logic wherever it's needed.
//
// A callback ref, not a plain useRef + useEffect(..., []) - the
// measured element here is conditionally rendered by an ASYNC state
// update (FooterTicker/CafeTemplate's own tickerEnabled starts false
// and flips true only once their PUBLIC_CONFIG_URL fetch resolves), not
// present at this component's initial mount. A plain ref's `.current`
// changing later doesn't re-run an effect with an empty dependency
// array, so the ResizeObserver would never attach at all for the very
// common case where the ticker turns on shortly after mount. A callback
// ref fires every time React actually attaches/detaches the DOM node,
// which is exactly the signal needed here.
export function useElementHeight<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [height, setHeight] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) {
      setHeight(0)
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  return [ref, height]
}
