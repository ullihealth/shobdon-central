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

const SUPPORT_EMAIL = 'support@airfieldcentral.com'
const DISCLAIMER = 'Information only — not for flight planning. Always check official sources.'

// Answer content for the newer, longer sections below is plain data
// (strings, no JSX) so apostrophes/quotes need no escaping and the copy is
// easy to review and edit. Inline: **bold** for on-screen button/page names,
// and the support address becomes a mailto link.
type FaqBlock = { p: string } | { steps: string[] } | { bullets: string[] } | { disclaimer: true }

interface FaqItemData {
  q: string
  blocks: FaqBlock[]
}

function renderInline(text: string) {
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

function FaqSteps({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{renderInline(item)}</li>
      ))}
    </ol>
  )
}

function FaqBullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item) => (
        <li key={item}>{renderInline(item)}</li>
      ))}
    </ul>
  )
}

function FaqItem({ q, blocks }: FaqItemData) {
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

function section(question: string, items: FaqItemData[]): FaqEntry {
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

const D: FaqBlock = { disclaimer: true }

// Growing list of Q&A entries - add another { question, answer } object
// here as new questions come up, nothing else on this page needs to
// change. `answer` is plain JSX rather than a markdown string: this
// codebase has no markdown renderer anywhere (confirmed before adding
// this page), and every other rich-content block here is already
// hand-coded JSX with Tailwind classes rather than parsed from a markup
// string - matching that rather than introducing a new dependency/parser
// for one page.
const FAQ_ENTRIES: FaqEntry[] = [
  section(`Your Account`, [
    {
      q: `How do I log in?`,
      blocks: [
        { steps: [`Go to your airfield's Airfield Central web address and add /login on the end.`, `Type your **Email** and **Password**.`, `Press **Sign in**.`] },
        { p: `After you log in you land on the page that suits your role: owners and admins go to Dashboard Manager, ATC goes to ATC Control, media goes to Dashboard Manager, and cafe goes to Cafe Media.` },
      ],
    },
    {
      q: `I've forgotten my password. What do I do?`,
      blocks: [
        { p: `There is no "forgot password" link on the Sign in page. Ask the owner of your account to reset it for you: they open **Members**, find your name and press **Reset password**. They will be shown a temporary password once. They copy it and send it to you directly. Then log in and change it on **My Account**.` },
        { p: `If you are the owner, or nobody can reset it for you, email support@airfieldcentral.com.` },
      ],
    },
    {
      q: `How do I add a team member?`,
      blocks: [
        { p: `Only the account owner can do this.` },
        { steps: [`Open **Members** (under People in the menu).`, `Under **Add a member**, type their **Email**.`, `Choose their **Role** (see below).`, `Press **Add member**.`] },
        { p: `A temporary password appears on screen. Copy it straight away because it is only shown once, and share it with them directly. If they already have an Airfield Central login, they are simply added and no new password is made.` },
        { p: `To take someone off, press **Remove** next to their name. It takes effect immediately.` },
      ],
    },
    {
      q: `What can each role do?`,
      blocks: [
        {
          bullets: [
            `**Owner:** everything, including adding and removing people.`,
            `**Admin:** the same pages as the owner (Dashboard Manager, ATC Control, Media Library, Weather Config, TV Schedule, Screens Design, Runways, Pilot Panel, Bug Reports and Feature Requests), but not adding or removing people.`,
            `**ATC:** ATC Control and Pilot Panel. They land on ATC Control after logging in.`,
            `**Media:** Dashboard Manager and Media Library.`,
            `**Cafe:** Cafe Media (Media Screen) and Media Library, and nothing else.`,
          ],
        },
      ],
    },
    {
      q: `How do I change my password?`,
      blocks: [
        { steps: [`Open **My Account** (bottom of the menu).`, `Under **Change password**, enter your **Current password**.`, `Enter a **New password** (at least 8 characters) and type it again under **Confirm new password**.`, `Press **Change password**. You will see "Password changed successfully."`] },
      ],
    },
    {
      q: `How do I change my email address?`,
      blocks: [{ p: `You can't change it yourself in the app. Email support@airfieldcentral.com from the address you use now and tell us the new one.` }],
    },
    {
      q: `Why am I being asked to accept updated terms?`,
      blocks: [
        { p: `When we update our Customer Terms or Privacy Policy, you are asked to read and agree to the new version the next time you log in. You'll see a page called **Before you continue**. Press **Agree & continue** to carry on.` },
        { p: `If you press **Disagree**, you'll see "Access on hold". Nothing is deleted or cancelled, and you can come back and agree at any time. You can read both documents at any time under **Support** in the menu.` },
      ],
    },
  ]),
  section(`Media Library & Dashboard Manager`, [
    {
      q: `How do I add a picture, video or PDF to the Media Library?`,
      blocks: [
        { steps: [`Open **Media Library**.`, `Press **+ Upload file** and choose your file.`, `Wait for the progress to reach 100%. The file then appears in the library.`] },
        { p: `You can upload images, MP4 videos and PDFs. Other file types are refused with "Unsupported file type - only images, MP4 video, and PDF are supported."` },
        { p: `You can also press **✨ Create Slide** to build a slide from inside the Media Library.` },
      ],
    },
    {
      q: `How much can I store?`,
      blocks: [{ p: `Your account has a storage allowance, shown at the top of the Media Library as "X MB of Y MB used". The standard allowance is 100 MB. Videos use it up fastest. If you need more, email support@airfieldcentral.com.` }],
    },
    {
      q: `What happens when my storage is full?`,
      blocks: [{ p: `The upload is refused and you see a message like: "This upload (12.0MB) would exceed your 100MB media storage limit - you're currently using 95.0MB. Delete something from the media library first." Delete files you no longer need, then try again.` }],
    },
    {
      q: `How do I put a picture or video on the dashboard screen?`,
      blocks: [
        { p: `Add it to the Media Library first, then choose it in a slot.` },
        {
          steps: [
            `Upload the file in **Media Library** (see above).`,
            `Click the file and check **Usable on** says **Dashboard** or **Both**. If it says **Café**, it won't appear for the dashboard.`,
            `Open **Dashboard Manager** and click the slot you want (there are 12).`,
            `Under **Source**, pick your file from the **Media library** list.`,
            `Make sure the tick box on that slot's row is ticked, so the slot is enabled.`,
          ],
        },
        { p: `Changes save on their own. You don't need to press a Save button.` },
      ],
    },
    {
      q: `How do I change the order of the slides, and how long each one shows?`,
      blocks: [
        { p: `The slides play in slot order: slot 1 first, then 2, and so on, and then round again. There is no drag-and-drop. To change the order, change what each slot's **Source** is set to.` },
        { p: `Under **Duration (seconds)** you set how long a picture shows. A video plays for its own length, which is detected when you upload it. **Total loop time** at the top of the slots shows how long one full cycle takes.` },
      ],
    },
    {
      q: `Can I show videos or live cameras?`,
      blocks: [
        {
          bullets: [
            `**Videos:** upload an MP4 to the Media Library and choose it in a slot. A slot whose video is still downloading to the screen appears in red until it is ready.`,
            `**Live cameras:** cameras we have set up for you appear in the **Webcams** list under **Source**. To add a camera, email support@airfieldcentral.com.`,
          ],
        },
      ],
    },
    {
      q: `How do I remove a file?`,
      blocks: [
        { steps: [`Open **Media Library** and click the file.`, `Press **Delete** and confirm.`] },
        { p: `If the file is still in a slot, you'll be told which slots. Change those slots to a different source (or untick them) first, then delete the file.` },
      ],
    },
    {
      q: `Why can't I edit some slots?`,
      blocks: [{ p: `Some slots are marked **Reserved by AirfieldCentral**. They are kept for our own content and can't be edited. All your other slots are yours to use.` }],
    },
    {
      q: `I've saved a change but it's not on the TV yet. Why?`,
      blocks: [
        {
          bullets: [
            `In **Dashboard Manager** your changes save by themselves, and your TV picks them up within about 30 seconds.`,
            `In **ATC Control** nothing reaches the TV until you press **Update Dashboard**. Press it, then allow about 30 seconds.`,
          ],
        },
        { p: `If it still hasn't changed after a couple of minutes, check the TV box has power and internet (see "TV Screen & Media Box").` },
      ],
    },
  ]),
  section(`ATC Control`, [
    {
      q: `How do I change the active runway and circuit direction?`,
      blocks: [
        { steps: [`Open **ATC Control**.`, `Under **Runway In Use**, press the runway end you want.`, `Under **Circuit Direction**, press **Left** or **Right**.`, `Press **Update Dashboard** (top right). Nothing reaches the TV until you do.`] },
        { p: `If **Auto-link runway & circuit** is ticked, choosing a runway also sets the matching circuit direction. Untick it to set them separately.` },
        { p: `If the buttons are locked, **SADDS Automation** is **On** and is setting them for you. Turn it **Off** to take over by hand.` },
        { p: `To close the runways, tick **Runways Closed**.` },
        D,
      ],
    },
    {
      q: `Why is the runway on my dashboard different from what I chose?`,
      blocks: [
        { p: `If your airfield is linked to a parent airfield, you'll see a red **Important** message on ATC Control. Your dashboard shows the parent airfield's Runway In Use and Circuit Direction, not yours. Your choice is still saved and takes effect if the link is ever removed.` },
        D,
      ],
    },
    {
      q: `How do I add, edit or clear a safety notice?`,
      blocks: [
        { steps: [`Open **ATC Control** and go to **Safety Notices**.`, `On a row, type a **Name** (for example "Bird Activity") and the notice text.`, `Tick the row's tick box to show it.`, `Press **Update Dashboard**.`] },
        { p: `To clear a notice, empty the row (leave it blank) or untick it, then press **Update Dashboard**. You can have up to 10 notices. They show below the automatic NOTAM feed. **Automated NOTAM Feed** can be turned **On** or **Off**, and **Rotation Interval (sec)** sets how long each view shows, between 2 and 30 seconds.` },
        D,
      ],
    },
    {
      q: `How do I change the Airfield Info line?`,
      blocks: [{ p: `On **ATC Control**, type in **Airfield Info** (for example "PPR only after 17:00") and press **Update Dashboard**.` }],
    },
    {
      q: `Is there a limit on how much I can type?`,
      blocks: [
        { p: `Yes, and the counter next to each box shows it:` },
        { bullets: [`**Airfield Info:** 60 characters.`, `Each safety notice's text: 40 characters.`, `Each safety notice's **Name:** 40 characters.`] },
        { p: `You can't type past the limit. If any text is longer when it's saved, it is shortened automatically.` },
      ],
    },
    {
      q: `What does "Failed to publish" mean?`,
      blocks: [{ p: `**Update Dashboard** didn't go through, so the live dashboard hasn't changed. Check your internet connection and press **Update Dashboard** again. If the message shows a number and some words after "Failed to publish", note them down and email support@airfieldcentral.com. Your typed changes stay on the page until you leave it.` }],
    },
  ]),
  section(`Weather`, [
    {
      q: `Where does the weather on my dashboard come from?`,
      blocks: [
        { p: `One of three places, and the small label on the screen tells you which:` },
        {
          bullets: [
            `**Your airfield's own weather station** (set as **ATC Live Weather Station** in Weather Config).`,
            `**A linked parent airfield's station**, if we have linked you to one (shown as **Third-Party Station**). Weather Config tells you "Currently using … weather station".`,
            `**The Met Office**, shown as **Met-Office** in blue. It is used automatically when a station isn't reporting.`,
          ],
        },
        { p: `If the screen says **NO LIVE READING** in red, no reliable reading is available, and it shows N/A instead of made-up numbers.` },
        D,
      ],
    },
    {
      q: `What happens if my weather station stops sending data?`,
      blocks: [
        { p: `If the weather station stops sending readings, the screen switches to Met Office weather within a few minutes, and switches back by itself when the station returns.` },
        { p: `On your airfield's own screens, switching back relies on **Auto-reconnect to ATC** being ticked in Weather Config (it is by default). If it's unticked, the screen stays on the Met Office until someone reconnects it.` },
        D,
      ],
    },
    {
      q: `How is Cloud Base worked out, and why does it say N/A?`,
      blocks: [
        { p: `Cloud Base is an estimate, not a measured cloud height. It is calculated as 400 × (air temperature − dew point), in feet above the airfield. It needs a real weather station's temperature and dew point.` },
        { p: `It shows **N/A** whenever the reading is from the Met Office (or any source that isn't a genuine weather station), because the calculation wouldn't be trustworthy. It comes back once real station readings return.` },
        D,
      ],
    },
    {
      q: `Why does Visibility say Unavailable?`,
      blocks: [
        { p: `**Visibility Outlook (Met Office Forecast)** is a forecast for the coming hours, not a measurement from your station (weather stations like yours don't measure visibility). It shows **Unavailable** if the Met Office forecast couldn't be fetched, and we never show a forecast that has gone out of date. It normally returns by itself.` },
        D,
      ],
    },
    {
      q: `My weather looks old. What should I check?`,
      blocks: [
        {
          steps: [
            `Look at the source label. Blue **Met-Office** means your station isn't reporting right now. **NO LIVE READING** means no source is working.`,
            `In the **Pilot's App**, an amber **Pull to Refresh** banner means the page hasn't updated for a while. Pull the page down to refresh it.`,
            `On a TV, check it has internet (see "TV Screen & Media Box").`,
            `If it says "WEATHER LOCATION NOT SET", open **Weather Config** and set your airfield's location.`,
            `If your station has stopped, check the computer or equipment that sends its readings is on and online. Email support@airfieldcentral.com if you need help.`,
          ],
        },
        D,
      ],
    },
  ]),
  {
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
  },
  section(`TV Schedule`, [
    {
      q: `How do I set when the TV turns on and off?`,
      blocks: [
        { steps: [`Open **Settings → TV Schedule**.`, `Tick **Turn the TV on and off automatically at these times**.`, `For each day, set the **Wake** time (TV on) and the **Sleep** time (TV off). Tick **Off all day** for a day when the TV should stay off.`, `Press **Save**. You'll see "Saved".`] },
        { p: `Times must be within the same day. The TV can't be set to switch off after midnight (for example "sleep at 01:00" is refused). Saving also clears any one-off "Turn TV on now" or "Turn TV off now" change.` },
      ],
    },
    {
      q: `Why can't I see TV Schedule in my settings?`,
      blocks: [{ p: `TV Schedule only shows for owners and admins, and only if your venue has a media box whose TV can be switched on and off automatically (this uses a TV feature called HDMI-CEC) and the box has connected to us at least once. If it's missing and you think it should be there, email support@airfieldcentral.com.` }],
    },
    {
      q: `What do "Turn TV on now" and "Turn TV off now" do?`,
      blocks: [
        { p: `They are for one-off changes. Press one and the TV changes straight away. You'll see:` },
        { bullets: [`After **Turn TV on now**: "You turned the TV on. It will go back to its normal times tomorrow at 7:00am."`, `After **Turn TV off now**: "You turned the TV off. It will go back to its normal times today at 10:00pm."`] },
        { p: `(The time shown is your own next scheduled on or off time.) The TV goes back to its normal times by itself at the next scheduled on or off time. They work even if someone switched the TV off or on with its own remote.` },
        { p: `If **Turn the TV on and off automatically at these times** is switched off (and saved), there are no normal times to go back to. The page then just says "You turned the TV on." or "You turned the TV off.", and the change stays for about an hour, after which the box leaves the TV exactly as it is.` },
      ],
    },
    {
      q: `How quickly do changes reach the TV?`,
      blocks: [{ p: `Within about a minute.` }],
    },
    {
      q: `Can we still use the TV's own remote?`,
      blocks: [{ p: `Yes. The box only changes the TV at your scheduled on and off times, or when you press one of the buttons on this page. Otherwise it leaves the TV alone.` }],
    },
  ]),
  section(`TV Screen & Media Box`, [
    {
      q: `The screen is blank or frozen. What do I do?`,
      blocks: [
        { steps: [`Check the TV is switched on and set to the right input (the HDMI input the box is plugged into).`, `Unplug the media box's power for 10 seconds, then plug it back in. It takes a few minutes to start.`, `If it's still not working, email support@airfieldcentral.com.`] },
        { p: `The box restarts itself early each morning (around 5am).` },
      ],
    },
    {
      q: `Our venue WiFi has changed. How do I get the box back online?`,
      blocks: [
        { p: `When the box can't find your WiFi, the TV shows a setup page with a QR code. It says "New WiFi, or the password changed? Scan this code with your phone to set up."` },
        { steps: [`Open your phone's camera and point it at the QR code on the TV.`, `Tap the notification that appears to join.`, `Pick your WiFi network from the list and enter its password.`] },
        { p: `If your phone can't join, wait a few seconds and scan again. If the password was wrong the TV says "That didn't work - please check the WiFi password and scan the code again". After a power cut it can say "WiFi not found. Reconnecting automatically." That can take up to 10 minutes and you don't need to do anything.` },
      ],
    },
    {
      q: `Should we move or unplug the box?`,
      blocks: [{ p: `Please don't, unless you have to. Keep it indoors somewhere dry and ventilated, use only the power supply we gave you, and keep it powered on and connected to the internet so we can look after it. If you must move it, tell us first.` }],
    },
    {
      q: `What if the box is faulty, damaged or lost?`,
      blocks: [{ p: `Tell us promptly at support@airfieldcentral.com. A fault through normal use is repaired or replaced free of charge. Loss, theft or damage (other than normal use) can be charged up to £99 per incident. We always tell you by email first and give you 7 days to respond. See Schedule 1 of the Customer Terms (under **Support** in the menu).` }],
    },
  ]),
  section(`Pilot's App`, [
    {
      q: `How do pilots open the Pilot's App and add it to their phone?`,
      blocks: [
        { p: `Your airfield will give you the Pilot's App link. Open it on your phone, then add it to your home screen so it opens like an app:` },
        { bullets: [`On iPhone, in Safari tap **Share**, then **Add to Home Screen**.`, `On Android, in Chrome tap the ⋮ menu, then **Add to Home screen** or **Install app**.`] },
      ],
    },
    {
      q: `What does "Update available — tap to refresh" mean?`,
      blocks: [{ p: `A newer version of the app is ready. Tap the banner to update. The app only ever updates when you tap it, so it never reloads by surprise while someone is reading it.` }],
    },
    {
      q: `Where is the version number, and why might support ask for it?`,
      blocks: [{ p: `At the bottom of the Pilot's App, a small line of text shows the version number. If you contact support, quote it so we know exactly which version you have.` }],
    },
    {
      q: `Can I use the Pilot's App for flight planning?`,
      blocks: [{ p: `No. It's for information only. Always check official sources (METAR, TAF, NOTAM, ATS).` }, D],
    },
  ]),
  section(`Support, Billing & Legal`, [
    {
      q: `How do I report a problem or suggest something?`,
      blocks: [{ p: `Open **Bug Reports** and fill in **Title** and **Description**, then press **Submit report**. A bug shows as Reported, Working, Fixed or Parked. For ideas, open **Feature Requests**, fill in **Title** and **Description**, then press **Submit request**. These two pages are for owners and admins.` }],
    },
    {
      q: `How do I contact support?`,
      blocks: [{ p: `Email support@airfieldcentral.com. We aim to reply within 2 working days.` }],
    },
    {
      q: `What do the plans include and cost?`,
      blocks: [
        {
          bullets: [
            `**Airfield Pack, £44 a month:** the Reception Dashboard for your clubhouse screen, plus the Pilot's App.`,
            `**Pilot's App, £29.99 a month:** just the mobile app for members and visiting pilots.`,
            `**Media Screen, £29.99 a month:** an add-on for a cafe or similar venue's screen. It needs the Airfield Pack.`,
          ],
        },
        { p: `Fees are monthly in advance by card. There is no free trial.` },
      ],
    },
    {
      q: `Where can I find my receipts?`,
      blocks: [{ p: `Email support@airfieldcentral.com and we'll help.` }],
    },
    {
      q: `How do I update my payment card?`,
      blocks: [{ p: `Email support@airfieldcentral.com and we'll help.` }],
    },
    {
      q: `What happens if a payment fails?`,
      blocks: [{ p: `We tell you, and our payment provider (Stripe) tries again. If the payment is still outstanding 14 days after it was due, we may suspend the service until it is paid.` }],
    },
    {
      q: `How do I cancel?`,
      blocks: [{ p: `Email support@airfieldcentral.com with at least 30 days' notice. Your subscription has a minimum term of 3 months from the start date. After that it runs month to month, and cancellation takes effect at the end of a billing month. If you have a Media Box, you must return it, with its accessories in good condition, within 14 days of your subscription ending. We'll agree how with you.` }],
    },
    {
      q: `Where do I find the Terms and Privacy Policy?`,
      blocks: [{ p: `Open **Support** in the menu. The Customer Terms (including the Media Box loan schedule) and the Privacy Policy are both on that page, and each has an **Open full page →** link.` }],
    },
  ]),
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
