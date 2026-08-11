import { PILOT_VERSION_LABEL } from '../../generated/pilotVersion'

// Pilot View footer version stamp - baked in at BUILD time
// (scripts/generate-pilot-version.mjs, run before every `npm run
// build`/`npm run dev`), not a live runtime fetch any more. Previously
// self-fetched /api/public/versions, which meant the number shown was
// live API data that could drift from whatever code was ACTUALLY
// running in this pilot's tab - the whole point of this round is for
// the version to be physically part of the same code bundle it's meant
// to represent, so it can only ever change when a genuinely new bundle
// (a new service worker - see the update banner, PilotUpdateBanner.tsx)
// actually takes over. platform_updates.version (assigned via
// /platform/dev-features's own release workflow) is still the ultimate
// source - see the generation script's own comment for exactly how it
// reads that at build time.
//
// Deliberately no longer accepts a refreshSignal prop (a previous round
// wired it to PilotViewPage.tsx's own refreshTick, so pull-to-refresh
// refetched it) - that's no longer meaningful now this is a build-time
// constant, not live data; re-fetching a static import on pull-to-
// refresh could never change what it shows.
//
// No loading/empty state either - PILOT_VERSION_LABEL is always a real
// string by construction (the generation script falls back to a
// placeholder rather than ever producing an empty/undefined value - see
// that script's own comment), so this can render unconditionally.
export default function PilotVersionStamp(): JSX.Element {
  return (
    <div className="w-full bg-panel/80 px-2 py-0.5 text-center text-[10px] font-medium tracking-wide text-muted-400 backdrop-blur">
      {PILOT_VERSION_LABEL}
    </div>
  )
}
