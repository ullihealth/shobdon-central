// Shared FAQ building blocks + the entries that the admin FAQ (HelpFaqPage.tsx)
// and the public Pilot's App help page (PilotHelpPage.tsx) both show. Anything
// that must read identically on both lives here, once, so the two can never
// drift apart. Page-specific wording stays in the page that owns it.

export interface FaqEntry {
  question: string
  answer: JSX.Element
}

// Small building block for an entry's answer - one bold, uppercase
// sub-heading (same text-sm font-bold uppercase tracking-widest
// text-accent-sky-400 convention HelpPage.tsx already uses for its own
// section labels) followed by a plain paragraph. Lets a single FAQ entry
// read as several connected sub-topics (see the wind/compass entry
// below) without inventing a second heading style just for this page.
export function FaqSubheading({ title, children }: { title: string; children: JSX.Element | string }): JSX.Element {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{title}</div>
      <p className="text-sm leading-relaxed text-muted-300">{children}</p>
    </div>
  )
}

export const SUPPORT_EMAIL = 'support@airfieldcentral.com'
export const DISCLAIMER = 'Information only — not for flight planning. Always check official sources.'

// Answer content for the newer, longer sections below is plain data
// (strings, no JSX) so apostrophes/quotes need no escaping and the copy is
// easy to review and edit. Inline: **bold** for on-screen button/page names,
// and the support address becomes a mailto link.
export type FaqBlock = { p: string } | { steps: string[] } | { bullets: string[] } | { disclaimer: true }

export interface FaqItemData {
  q: string
  blocks: FaqBlock[]
}

export function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|support@airfieldcentral\.com)/).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part === SUPPORT_EMAIL) {
      return (
        <a key={index} href={`mailto:${SUPPORT_EMAIL}`} className="break-all font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          {part}
        </a>
      )
    }
    return part
  })
}

export function FaqSteps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{renderInline(item)}</li>
      ))}
    </ol>
  )
}

export function FaqBullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{renderInline(item)}</li>
      ))}
    </ul>
  )
}

export function FaqItem({ q, blocks }: FaqItemData) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent-sky-400">{q}</div>
      <div className="space-y-2 text-sm leading-relaxed text-muted-300">
        {blocks.map((block, index) => {
          if ('p' in block) return <p key={index}>{renderInline(block.p)}</p>
          if ('steps' in block) return <FaqSteps key={index} items={block.steps} />
          if ('bullets' in block) return <FaqBullets key={index} items={block.bullets} />
          return (
            <p key={index} className="text-xs italic text-muted-400">
              {DISCLAIMER}
            </p>
          )
        })}
      </div>
    </div>
  )
}

export function section(question: string, items: FaqItemData[]): FaqEntry {
  return {
    question,
    answer: (
      <>
        {items.map((item) => (
          <FaqItem key={item.q} {...item} />
        ))}
      </>
    ),
  }
}

export const D: FaqBlock = { disclaimer: true }


// Add-to-home-screen steps, used by both pages (each supplies its own intro line).
export const HOME_SCREEN_BULLETS: FaqBlock = { bullets: [`On iPhone, in Safari tap **Share**, then **Add to Home Screen**.`, `On Android, in Chrome tap the ⋮ menu, then **Add to Home screen** or **Install app**.`] }

export const WIND_COMPASS_ENTRY: FaqEntry = {
  question: 'How the Wind & Compass Indicators Work',
  answer: (
    <>
      <FaqSubheading title="Where does the wind data come from?">
        {`Wind readings come from the weather source your dashboard is using. That is usually your airfield's own live weather station, or a linked parent airfield's station. If that station stops reporting, the dashboard switches to Met Office data automatically, shown by a blue Met-Office label, and switches back when the station recovers. The compass needle always shows the wind direction from whichever reading is on screen, exactly as reported. ${DISCLAIMER}`}
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
      <p className="mt-4 text-xs italic text-muted-400">{DISCLAIMER}</p>
    </>
  ),
}

export const FAQ_CLOUD_BASE: FaqItemData = {
  q: `How is Cloud Base worked out, and why does it say N/A?`,
  blocks: [
    { p: `Cloud Base is an estimate, not a measured cloud height. It is calculated as 400 × (air temperature − dew point), in feet above the airfield. It needs a real weather station's temperature and dew point.` },
    { p: `It shows **N/A** whenever the reading is from the Met Office (or any source that isn't a genuine weather station), because the calculation wouldn't be trustworthy. It comes back once real station readings return.` },
    D,
  ],
}

export const FAQ_UPDATE_BANNER: FaqItemData = {
  q: `What does "Update available — tap to refresh" mean?`,
  blocks: [{ p: `A newer version of the app is ready. Tap the banner to update. The app only ever updates when you tap it, so it never reloads by surprise while someone is reading it.` }],
}

export const FAQ_VERSION_NUMBER: FaqItemData = {
  q: `Where is the version number, and why might support ask for it?`,
  blocks: [{ p: `At the bottom of the Pilot's App, a small line of text shows the version number. If you contact support, quote it so we know exactly which version you have.` }],
}

export const FAQ_FLIGHT_PLANNING: FaqItemData = {
  q: `Can I use the Pilot's App for flight planning?`,
  blocks: [{ p: `No. It's for information only. Always check official sources (METAR, TAF, NOTAM, ATS).` }, D],
}

