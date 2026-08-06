import { useState } from 'react'
import type { ReactNode } from 'react'

interface PilotCollapsibleSectionProps {
  title: string
  children: ReactNode
  sectionClassName?: string
  titleClassName?: string
  chevronClassName?: string
  defaultExpanded?: boolean
}

// Same collapsed-by-default accordion pattern TickerSettingsCards.tsx's
// own "Ticker Style" section already established (flex justify-between
// button, title left, rotating chevron right) - not a new UI idiom
// invented for this round. Section-level styling is parameterized
// rather than fixed to one look, since Notices' own distinct accent-sky
// treatment (kept visually different from NOTAMs/Forecast per the
// original Pilot View spec, so the two don't blur together at a glance)
// needs to survive being collapsed into this shared wrapper.
//
// Children keep fetching/refreshing on their own existing schedule
// regardless of collapsed state - this only ever hides/shows already-
// rendered output, never gates data loading, so expanding a section
// never shows a stale "loading" flash for something that could have
// been kept warm in the background the whole time.
export default function PilotCollapsibleSection({
  title,
  children,
  sectionClassName = 'rounded-2xl border border-border bg-panel p-4',
  titleClassName = 'text-xl font-semibold uppercase tracking-[0.25em] text-muted-400',
  chevronClassName = 'text-muted-400',
  defaultExpanded = false,
}: PilotCollapsibleSectionProps): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <section className={sectionClassName}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between"
        aria-expanded={expanded}
      >
        <span className={titleClassName}>{title}</span>
        <span className={`shrink-0 text-lg transition-transform ${expanded ? 'rotate-180' : ''} ${chevronClassName}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {expanded && <div className="mt-3">{children}</div>}
    </section>
  )
}
