import { Link } from 'react-router-dom'
import { PILOT_DISCLAIMER_LINK_TEXT, PILOT_DISCLAIMER_TEXT } from '../../content/legalTerms'

interface PilotInfoFooterProps {
  // The left-hand button: "Help" on the Pilot's App page, "Back to Pilot's
  // App" on the help page. The right-hand button is always Terms of use.
  primaryTo: string
  primaryLabel: string
}

// Shared footer block for the Pilot's App page (/pilot) and its help page
// (/pilot-help): divider, two equal buttons styled like the page's own
// collapsible cards (same panel fill, border colour and corner radius, and
// the same uppercase letter-spaced title font at a smaller size), then the
// full disclaimer as quiet secondary text. Buttons are at least 44px tall
// for easy tapping and carry no underline. Normal in-flow block - the
// caller keeps it clear of the fixed version stamp/ticker with its own
// bottom padding.
const BUTTON_CLASS =
  'flex min-h-[44px] flex-1 items-center justify-center rounded-2xl border border-border bg-panel px-3 py-2 text-center text-sm font-semibold uppercase tracking-[0.2em] text-muted-400 no-underline transition hover:border-accent-sky-500 hover:text-slate-200'

export default function PilotInfoFooter({ primaryTo, primaryLabel }: PilotInfoFooterProps) {
  return (
    <div className="mt-4 border-t border-border pt-5 pb-6">
      <div className="flex gap-3">
        <Link to={primaryTo} className={BUTTON_CLASS}>
          {primaryLabel}
        </Link>
        <Link to="/pilot-terms" className={BUTTON_CLASS}>
          {PILOT_DISCLAIMER_LINK_TEXT}
        </Link>
      </div>
      <p className="mt-4 px-2 text-center text-sm leading-relaxed text-muted-400">{PILOT_DISCLAIMER_TEXT}</p>
    </div>
  )
}
