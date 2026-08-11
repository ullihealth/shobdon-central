interface PilotUpdateBannerProps {
  onTap: () => void
}

// Pilot View PWA update banner - shown only once usePilotServiceWorker
// detects a new service worker sitting in registration.waiting (see
// that hook's own comment on why skipWaiting() no longer runs
// unconditionally). Calm, not urgent: same border-border/bg-panel
// treatment PilotHeader.tsx already uses rather than a bright alert
// colour - this is "a newer version exists whenever you're ready", not
// a safety notice, so it shouldn't compete visually with AFISO/NOTAMs.
// Deliberately NOT sticky/fixed - a plain block at the top of the page
// that scrolls away with the rest of the content, rather than staying
// pinned and fighting for attention. Tapping it is the ONLY way this
// ever reloads the page - see applyUpdate's own comment in
// usePilotServiceWorker.ts.
export default function PilotUpdateBanner({ onTap }: PilotUpdateBannerProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center justify-center gap-2 border-b border-border bg-panel/95 px-4 py-2 text-sm font-semibold text-accent-sky-400"
    >
      Update available — tap to refresh
    </button>
  )
}
