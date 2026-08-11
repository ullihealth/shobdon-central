import { Link } from 'react-router-dom'
import PilotCollapsibleSection from '../components/pilot/PilotCollapsibleSection'

interface FaqEntry {
  question: string
  answer: JSX.Element
}

// Small building block for an entry's answer - one bold, uppercase
// sub-heading (same text-sm font-bold uppercase tracking-widest
// text-accent-sky-400 convention HelpPage.tsx already uses for its own
// section labels) followed by a plain paragraph. Lets a single FAQ entry
// read as several connected sub-topics (see the wind/compass entry
// below) without inventing a second heading style just for this page.
function FaqSubheading({ title, children }: { title: string; children: JSX.Element | string }): JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{title}</div>
      <p className="text-sm leading-relaxed text-muted-300">{children}</p>
    </div>
  )
}

// Growing list of Q&A entries - add another { question, answer } object
// here as new questions come up, nothing else on this page needs to
// change. `answer` is plain JSX rather than a markdown string: this
// codebase has no markdown renderer anywhere (confirmed before adding
// this page), and every other rich-content block here is already
// hand-coded JSX with Tailwind classes rather than parsed from a markup
// string - matching that rather than introducing a new dependency/parser
// for one page.
const FAQ_ENTRIES: FaqEntry[] = [
  {
    question: 'How the Wind & Compass Indicators Work',
    answer: (
      <>
        <FaqSubheading title="Where does the wind data come from?">
          All wind readings come from the airfield&apos;s own live weather feed. The compass needle position always
          reflects that live wind direction, exactly as reported.
        </FaqSubheading>
        <FaqSubheading title="What's the difference between NORTH and RUNWAY view?">
          NORTH view draws the compass with true north at the top, as a standard compass would be. RUNWAY view
          rotates the same compass so the airfield&apos;s currently active runway heading sits at the top instead,
          giving an intuitive &quot;which way is the wind relative to my takeoff or landing direction&quot; view.
          Switching between these two views only changes the orientation the compass is drawn from. It never
          changes, adjusts, or reinterprets the underlying wind data itself.
        </FaqSubheading>
        <FaqSubheading title="How is the windsock image calibrated?">
          The windsock image updates in five stages as wind strength increases. This is modelled on the FAA/ICAO
          windsock calibration standard: a windsock is designed to reach full extension at 15 knots, with
          intermediate stages representing roughly 3-knot increments (3, 6, 9, 12, 15kt). This part of the display
          isn&apos;t something we&apos;ve defined ourselves, it mirrors how a physical windsock is built to behave,
          at any airfield.
        </FaqSubheading>
        <FaqSubheading title="Why does the compass needle or wind arrow turn amber or red?">
          The needle and wind arrow change colour based on the wind&apos;s headwind and crosswind components
          relative to the active runway. Green means conditions currently read as favourable for the active runway.
          Amber means a marginal headwind, or a crosswind component approaching a level worth extra attention. Red
          means a tailwind component beyond the set threshold.
        </FaqSubheading>
        <FaqSubheading title="Are these colour thresholds an official aviation standard?">
          No, and we want to be upfront about that. These thresholds are values we&apos;ve defined ourselves as
          sensible general-aviation defaults. They are not drawn from a specific published FAA or ICAO table, as no
          single universal standard exists for this particular display (crosswind limits, for instance, are set per
          aircraft type by the manufacturer, not by a universal number). Every airfield on the platform starts with
          the same default thresholds. Any airfield can request that theirs be adjusted to better match their own
          operating judgement.
        </FaqSubheading>
        <FaqSubheading title="What do the green and red bars at each end of the runway mean?">
          Those are threshold lights. Green marks whichever end of the runway is currently active (the direction
          selected for takeoffs and landings); red marks the other end. This is set directly by whoever is running
          the field and updates immediately when the active runway changes, independent of the wind reading itself.
        </FaqSubheading>
        <FaqSubheading title="Why does the label sometimes say 'Downwind' instead of 'Headwind'?">
          Once the wind is coming from more than 90&deg; off the active runway&apos;s heading, it&apos;s genuinely
          blowing from behind rather than ahead, so the label switches from Headwind to Downwind to reflect that.
          The colour (green, amber or red) still shows severity the same way either side of that 90&deg; line, so
          it&apos;s worth watching colour even while it still says Headwind, not just once it flips to Downwind.
        </FaqSubheading>
        <FaqSubheading title="What does the number in the middle of the compass mean?">
          That&apos;s the same live wind reading everything else on the display is built from, shown as direction
          then speed &mdash; for example &quot;280 / 7&quot; means wind from 280&deg; at 7 knots.
        </FaqSubheading>
      </>
    ),
  },
]

// Split out from /help itself (see that page's own comment on its FAQ
// link) so a growing Q&A list has room to grow indefinitely without
// that page's fixed-height Terms/Privacy scroll-boxes setting the
// pattern for this content too. Deliberately simple for now (a stacked
// list of collapsible entries, no search/categories/etc) - a fuller
// support-page redesign is expected later; this is a starting point,
// not the final shape.
export default function HelpFaqPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link to="/help" className="mb-4 inline-block text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
        ← Back to Help
      </Link>
      <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">FAQ</h1>
      <p className="mb-8 max-w-2xl text-sm text-muted-400">Answers to common questions about how the dashboard works.</p>

      <div className="flex flex-col gap-4">
        {FAQ_ENTRIES.map((entry) => (
          <PilotCollapsibleSection
            key={entry.question}
            title={entry.question}
            sectionClassName="rounded-2xl border border-border bg-panel p-6"
            titleClassName="text-left text-sm font-bold uppercase tracking-widest text-accent-sky-400"
          >
            {entry.answer}
          </PilotCollapsibleSection>
        ))}
      </div>
    </div>
  )
}
