import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ScrollGatedViewerProps {
  children: ReactNode
  reachedBottom: boolean
  onReachedBottom: () => void
  heightClassName?: string
}

const BOTTOM_THRESHOLD_PX = 4

// Fixed-height scrollable viewer that reports (via onReachedBottom) once
// the reader has scrolled to the bottom - the standard "force-read"
// pattern for Terms/Privacy content, driven by actual scroll position,
// not a timer. Also checked on mount: short content that doesn't
// overflow the box at all must count as "read" immediately, otherwise
// it'd be permanently un-scrollable yet permanently blocking the
// checkbox. reachedBottom/onReachedBottom are lifted to the parent
// (rather than owned here) so OnboardingTermsPage can gate its own
// Agree button on both viewers at once.
//
// Terms-versioning round: takes `children` (rendered content) instead of
// a plain `text` string - the real Customer Terms needs actual
// structural rendering (headings, numbered clauses - see
// LegalMarkdown.tsx), which plain-text paragraph-splitting can't
// represent. Only consumer is OnboardingTermsPage.tsx, so this is a safe
// API change, not a breaking one for anything else.
export default function ScrollGatedViewer({ children, reachedBottom, onReachedBottom, heightClassName = 'h-64' }: ScrollGatedViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  function checkReachedBottom(el: HTMLDivElement) {
    if (!reachedBottom && el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD_PX) {
      onReachedBottom()
    }
  }

  useEffect(() => {
    if (containerRef.current) checkReachedBottom(containerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      onScroll={(event) => checkReachedBottom(event.currentTarget)}
      className={`${heightClassName} overflow-y-auto rounded-lg border border-border bg-slate-900/60 p-4 text-muted-300`}
    >
      {children}
    </div>
  )
}
