import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AIRFIELD_TIMEZONE } from '../../config/publicApi'

type DisplayMode = 'local' | 'zulu'

const ONBOARDING_SEEN_KEY = 'localTimeToggleToastSeen'

// Tap-to-toggle round - replaces the old developer-only pilotClockMode
// system (three modes: 'summer'/'gmt'/'utc', set via DeveloperToolsPage.
// tsx's PilotClockModeToggle, ops_panel_state.pilot_clock_mode) with a
// simpler, always-available, user-facing Local/Zulu toggle - approved
// explicitly given the two systems would otherwise conflict. This
// component no longer fetches or reads pilotClockMode at all - that
// developer toggle still exists and still saves (DeveloperToolsPage.tsx
// untouched, out of this round's scope), it just has no effect here
// anymore.
//
// Local is real Europe/London civil time via the IANA tz database
// (toLocaleTimeString already knows the real BST/GMT transition dates -
// no hand-rolled DST calculation needed, and it can never disagree with
// itself the way a separately-computed offset could). Zulu is the exact
// same computation the old 'utc' mode always used, kept byte-for-byte
// unchanged as instructed.
function localTimeString(now: Date): string {
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: AIRFIELD_TIMEZONE })
}
function zuluTimeString(now: Date): string {
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })
}

// Pilot View header - small extraction of Header.tsx's own clock logic
// (not imported from that file directly - Header.tsx is TV-header-
// specific, not otherwise prop-driven/reusable, and this is small
// enough that duplicating it matches this codebase's own established
// stance on small single-purpose UI bits, same reasoning
// RunwayInUseCard.tsx's own comment gives). Desktop's own Header.tsx
// clock is completely untouched by this round - the Local/Zulu toggle
// only ever reaches this one component.
export default function LiveClock(): JSX.Element {
  const [now, setNow] = useState(new Date())
  const [displayMode, setDisplayMode] = useState<DisplayMode>('local')
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  // One-time onboarding modal - shown the first time this device loads
  // Pilot View after this feature shipped, never again once dismissed.
  // Wrapped in try/catch - localStorage can throw (private-browsing
  // edge cases on some browsers), and failing to read/write the seen
  // flag should never break the clock itself, worst case the modal
  // just shows again on a later visit.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) setShowOnboarding(true)
    } catch {
      // Can't read the flag - fail closed by not showing it, rather
      // than risking it showing every single visit on a device where
      // writing the flag also silently fails.
    }
  }, [])

  function dismissOnboarding() {
    setShowOnboarding(false)
    try {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, 'true')
    } catch {
      // Same posture as above - a failed write just means the modal
      // may show again next visit, not a crash.
    }
  }

  const time = displayMode === 'local' ? localTimeString(now) : zuluTimeString(now)
  const suffix = displayMode === 'local' ? 'LOCAL' : 'Z'

  // text-3xl/font-extrabold matches Header.tsx's own TV-dashboard clock
  // treatment (that file's own comment: "text-lg font-extrabold
  // text-primary sm:text-5xl") - no font-mono here, this app's standard
  // sans-serif face throughout, not a monospace/typewriter fallback.
  // Suffix is deliberately smaller and a distinct colour, not just a
  // dimmer version of the time itself - text-accent-sky-400 is the same
  // neon blue already used for CIRCUIT (RunwayWindWidget.tsx) and Club
  // Safety Notices elsewhere on this same page. Both text treatments are
  // completely unchanged by the tap-toggle round below - only which of
  // the two suffix strings ("LOCAL" vs "Z") and which computed time
  // shows now varies, per spec's own "reuse the exact same styling,
  // don't introduce new styling" instruction.
  return (
    <>
      {/* Tap target round - same button semantics (type="button",
          descriptive aria-label, transition + hover feedback) as
          PilotWindCard.tsx's own tappable camera icon elsewhere on this
          same page, adapted for a text target rather than an icon: -mx/
          -my padding enlarges the actual hit area for touch without
          shifting where the text itself visually sits (the negative
          margin exactly cancels the added padding's own offset). No new
          font/size/weight/colour - bg-transparent and the hover opacity
          are the only rules this button itself contributes. */}
      <button
        type="button"
        onClick={() => setDisplayMode((mode) => (mode === 'local' ? 'zulu' : 'local'))}
        aria-label={`Showing ${displayMode === 'local' ? 'local' : 'Zulu'} time - tap to switch to ${displayMode === 'local' ? 'Zulu' : 'local'} time`}
        className="-mx-2 -my-1 rounded-lg bg-transparent px-2 py-1 transition hover:opacity-80"
      >
        <span className="text-3xl font-extrabold text-primary">
          {time} <span className="text-lg font-bold text-accent-sky-400">{suffix}</span>
        </span>
      </button>
      {/* Onboarding modal - deliberately NOT the self-dismissing toast
          pattern used elsewhere in this codebase (SlideEditor.tsx/
          PilotWindCard.tsx) - spec calls for no auto-dismiss and no
          tap-outside-to-dismiss, only an explicit OK button, which is a
          genuinely different (blocking, modal) interaction. Mirrors
          DesignPage.tsx's own existing confirm-modal shape (backdrop +
          centered card + body text + button) rather than inventing a
          new visual pattern - the backdrop itself has no onClick, so
          tapping outside does nothing, exactly as specified.

          Portaled to document.body - PilotHeader.tsx renders <LiveClock>
          inside its own <header className="sticky ... backdrop-blur">.
          backdrop-blur is Tailwind's backdrop-filter, and backdrop-
          filter on an ancestor creates a new containing block for
          position:fixed descendants (same family as transform/filter/
          perspective/will-change - the exact issue already solved twice
          elsewhere this session, OverscanSafeFrame's own transform and
          MediaPanel.tsx's fullscreen portal). Without the portal, this
          modal's "fixed inset-0" was being confined to the HEADER's own
          small box instead of the true viewport - confirmed as the
          actual root cause of the reported cut-off/overlap bug, not a
          sizing issue on its own. */}
      {showOnboarding &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label="New feature" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
            {/* Enlarged round - max-w-sm/p-6/text-sm read as cramped on a
                real phone. max-w-md/p-8/text-2xl (plus a full-width, generously-
                padded button) reads as a proper mobile onboarding dialog at
                arm's length, not a compact desktop-style confirm box. */}
            <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-8 shadow-2xl">
              <p className="text-2xl leading-snug text-slate-200">New feature: tap on the clock to toggle between local time and Zulu time.</p>
              <div className="mt-8">
                <button
                  type="button"
                  onClick={dismissOnboarding}
                  className="w-full rounded-lg border border-accent-sky-500 bg-slate-900/80 px-6 py-4 text-lg font-bold uppercase tracking-wide text-slate-200 transition hover:bg-accent-sky-500/10"
                >
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
