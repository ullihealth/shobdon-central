import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import PilotCollapsibleSection from '../components/pilot/PilotCollapsibleSection'
import PilotInfoFooter from '../components/pilot/PilotInfoFooter'
import {
  D,
  FAQ_CLOUD_BASE,
  FAQ_FLIGHT_PLANNING,
  FAQ_UPDATE_BANNER,
  FAQ_VERSION_NUMBER,
  HOME_SCREEN_BULLETS,
  WIND_COMPASS_ENTRY,
  FaqItem,
  type FaqItemData,
} from '../content/faqShared'

// Public, unauthenticated - /pilot-help. Linked from the bottom of every
// Pilot's App screen (PilotViewPage.tsx), beside the Terms of use link.
// Written for visiting pilots, not airfield staff: nothing here about admin
// pages, media, billing, TV schedules, accounts or Members. Entries that
// also appear in the admin FAQ come from content/faqShared.tsx so the two
// can never drift apart; the wording below is pilot-only. Same bare "no
// RequireAuth" posture as /pilot-terms, and no Host-specific handling - it
// works on whichever tenant address the pilot arrived on.

const WEATHER_ITEMS: FaqItemData[] = [
  {
    q: `Where does the weather come from?`,
    blocks: [
      { p: `The weather on screen comes from one of three places: the airfield's own weather station, a linked airfield's weather station, or the Met Office. A blue **Met-Office** label means Met Office weather is being shown.` },
      { p: `If the screen says **NO LIVE READING** in red, no reliable reading is available, and it shows N/A instead of made-up numbers.` },
      D,
    ],
  },
  {
    q: `What happens if the weather station stops sending data?`,
    blocks: [
      { p: `If the weather station stops sending readings, the screen switches to Met Office weather within a few minutes, and switches back by itself when the station returns.` },
      D,
    ],
  },
  FAQ_CLOUD_BASE,
  {
    q: `Why does Visibility show a Met Office forecast, or Unavailable?`,
    blocks: [
      { p: `**Visibility** is a Met Office forecast for the coming hours, not a measurement from a weather station. It shows **Unavailable** if the Met Office forecast couldn't be fetched, and we never show a forecast that has gone out of date. It normally returns by itself.` },
      D,
    ],
  },
]

const APP_ITEMS: FaqItemData[] = [
  {
    q: `How do I add the Pilot's App to my home screen?`,
    blocks: [
      { p: `Open the Pilot's App on your phone, then add it to your home screen so it opens like an app:` },
      HOME_SCREEN_BULLETS,
    ],
  },
  FAQ_UPDATE_BANNER,
  FAQ_VERSION_NUMBER,
]

const PROBLEM_ITEMS: FaqItemData[] = [
  {
    q: `Something isn't working. What should I do?`,
    blocks: [{ p: `Tell the airfield, or email support@airfieldcentral.com, and include the version number shown at the bottom of the screen.` }],
  },
]

const SECTION_TITLE_CLASS = 'text-left text-sm font-bold uppercase tracking-widest text-accent-sky-400'
const SECTION_CLASS = 'rounded-2xl border border-border bg-panel p-4'

function Items({ items }: { items: FaqItemData[] }) {
  return (
    <>
      {items.map((item) => (
        <FaqItem key={item.q} {...item} />
      ))}
    </>
  )
}

const SECTIONS: { key: string; title: string; content: () => ReactNode }[] = [
  { key: 'read', title: 'How to read the screen', content: () => WIND_COMPASS_ENTRY.answer },
  { key: 'weather', title: 'Weather', content: () => <Items items={WEATHER_ITEMS} /> },
  { key: 'app', title: "Using the Pilot's App", content: () => <Items items={APP_ITEMS} /> },
  { key: 'planning', title: 'Flight planning', content: () => <Items items={[FAQ_FLIGHT_PLANNING]} /> },
  { key: 'problems', title: 'Problems with the app', content: () => <Items items={PROBLEM_ITEMS} /> },
]

export default function PilotHelpPage() {
  useEffect(() => {
    document.title = `Pilot's App Help — AirfieldCentral`
  }, [])

  // One section open at a time: opening one closes any other, tapping the
  // open one closes it. Uses PilotCollapsibleSection's opt-in controlled mode.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // After a section opens, a section above it may just have closed and
  // pulled the opened heading off-screen - bring it back smoothly
  // (scroll-mt-4 on the wrapper leaves a little room above it). Only
  // scrolls when the heading isn't already comfortably in view.
  useEffect(() => {
    if (!openKey) return
    const frame = window.requestAnimationFrame(() => {
      const element = sectionRefs.current[openKey]
      if (!element) return
      const rect = element.getBoundingClientRect()
      if (rect.top < 8 || rect.top > window.innerHeight - 80) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [openKey])

  return (
    <div className="min-h-screen bg-gradient-to-b from-page-from via-page-via to-page-to px-4 pb-10 pt-6 text-slate-100">
      <div className="mx-auto max-w-lg">
        <Link to="/pilot" className="mb-4 inline-block text-sm font-semibold text-accent-sky-400 hover:text-accent-sky-500">
          ← Back to Pilot&apos;s App
        </Link>
        <h1 className="mb-2 text-2xl font-black uppercase tracking-wide text-primary">Pilot&apos;s App Help</h1>
        <p className="mb-6 text-sm text-muted-400">How to read the screen, where the weather comes from, and how to get the most from the app.</p>

        <div className="flex flex-col gap-4">
          {SECTIONS.map((section) => (
            <div
              key={section.key}
              ref={(element) => {
                sectionRefs.current[section.key] = element
              }}
              className="scroll-mt-4"
            >
              <PilotCollapsibleSection
                title={section.title}
                sectionClassName={SECTION_CLASS}
                titleClassName={SECTION_TITLE_CLASS}
                expanded={openKey === section.key}
                onToggle={() => setOpenKey((current) => (current === section.key ? null : section.key))}
              >
                {section.content()}
              </PilotCollapsibleSection>
            </div>
          ))}
        </div>

        <PilotInfoFooter primaryTo="/pilot" primaryLabel="Back to Pilot's App" />
      </div>
    </div>
  )
}
