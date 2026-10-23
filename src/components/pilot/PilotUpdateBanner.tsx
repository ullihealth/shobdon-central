import { createPortal } from 'react-dom'

interface PilotUpdateBannerProps {
  // 'available': a new version is waiting - shows the "Update now" button.
  // 'updating' : a forced / automatic update is in progress - no button.
  mode: 'available' | 'updating'
  onUpdate: () => void
}

// Pilot's App update box (replaces the old thin "Update available - tap to
// refresh" strip, which most pilots never noticed). A large centred box over a
// dimmed, blurred backdrop covering the whole app, so the outdated app behind
// it is hard to read or use until it has updated. Deliberately NO dismiss /
// close: the only ways out are "Update now" (tap) or the update completing.
// Portalled to <body> so no ancestor's transform/overflow can clip or trap it.
//
// Update policy (supersedes the original "a tap is the only way the app
// reloads" rule): the app reloads when the pilot taps "Update now", when a
// developer "Force Pilot App update" arrives, or automatically after a release
// (src/config/pilotUpdatePolicy.ts) - see README "Pilot's App updates".
// Look matches the Pilot's App onboarding dialog (LiveClock.tsx).
export default function PilotUpdateBanner({ mode, onUpdate }: PilotUpdateBannerProps): JSX.Element {
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="App update"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
    >
      <div className="w-[88%] max-w-md rounded-2xl border border-accent-sky-500/60 bg-panel p-8 text-center shadow-2xl">
        <p className="text-2xl font-semibold leading-snug text-slate-100">
          {mode === 'updating' ? 'Updating to the latest version…' : 'A new version of the app is available'}
        </p>
        {mode === 'available' ? (
          <button
            type="button"
            onClick={onUpdate}
            className="mt-8 w-full rounded-lg border border-accent-sky-500 bg-accent-sky-500/15 px-6 py-5 text-xl font-bold uppercase tracking-wide text-accent-sky-400 transition hover:bg-accent-sky-500/25"
          >
            Update now
          </button>
        ) : (
          <div className="mx-auto mt-8 h-8 w-8 animate-spin rounded-full border-4 border-slate-600 border-t-accent-sky-400" aria-hidden="true" />
        )}
      </div>
    </div>,
    document.body
  )
}
