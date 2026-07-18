import { useEffect, useRef } from 'react'
import { splitParagraphs } from '../utils/splitParagraphs'

interface ScrollGatedViewerProps {
  text: string
  reachedBottom: boolean
  onReachedBottom: () => void
  heightClassName?: string
}

const BOTTOM_THRESHOLD_PX = 4

// Fixed-height scrollable viewer that reports (via onReachedBottom) once
// the reader has scrolled to the bottom - the standard "force-read"
// pattern for Terms/Privacy content, driven by actual scroll position,
// not a timer. Also checked on mount: short placeholder text that
// doesn't overflow the box at all must count as "read" immediately,
// otherwise it'd be permanently un-scrollable yet permanently blocking
// the checkbox - exactly the edge case real (short) dummy legal text
// hits today. reachedBottom/onReachedBottom are lifted to the parent
// (rather than owned here) so OnboardingTermsPage can gate its own
// Agree button on both viewers at once.
export default function ScrollGatedViewer({ text, reachedBottom, onReachedBottom, heightClassName = 'h-64' }: ScrollGatedViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  function checkReachedBottom(el: HTMLDivElement) {
    if (!reachedBottom && el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD_PX) {
      onReachedBottom()
    }
  }

  useEffect(() => {
    if (containerRef.current) checkReachedBottom(containerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const paragraphs = splitParagraphs(text)

  return (
    <div
      ref={containerRef}
      onScroll={(event) => checkReachedBottom(event.currentTarget)}
      className={`${heightClassName} overflow-y-auto rounded-lg border border-border bg-slate-900/60 p-4 text-sm leading-relaxed text-muted-300`}
    >
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="mb-3 whitespace-pre-wrap last:mb-0">
          {paragraph}
        </p>
      ))}
    </div>
  )
}
