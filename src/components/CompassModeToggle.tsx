import { useState } from 'react'

// Extracted from CompassPanel.tsx (/runways round) so /pilot's compass and
// /runways' admin preview share one real implementation of the North/
// Runway toggle, not two hand-kept-in-sync copies - the two callers have
// very different surrounding layouts (CompassPanel.tsx positions the pair
// at the compass circle's own left/right "shoulders" via justify-between;
// RunwaysPage.tsx just wants them sitting inline next to a button), so
// this only extracts the STATE + the two <button> elements themselves
// (as a fragment, no wrapping row) - each caller supplies its own
// surrounding flex container and decides how to lay them out. Zero
// weather/published-config dependency here (unlike CompassPanel.tsx
// itself) - just a north/runway preference and localStorage, which is
// exactly why this piece (and only this piece) is safe to share with
// RunwayStripPreview.tsx's world, which deliberately never imports
// anything else from CompassPanel.tsx (see that file's own header
// comment on why - it previews a staged, possibly-unsaved edit, not the
// live published dashboard).
export type CompassMode = 'north' | 'runway'

// No manual tenant-id prefix needed - each tenant already lives on its
// own subdomain, so localStorage is natively per-tenant. Shared across
// every caller of useCompassMode deliberately, same key /pilot always
// used - a preference set on /runways carries over to /pilot and vice
// versa, which is the intended "one shared toggle" behaviour, not a
// coincidence of reusing the constant.
const COMPASS_MODE_STORAGE_KEY = 'pilotCompassMode'

// defaultMode only governs the FIRST-EVER load, when nothing has been
// stored yet - a real stored preference (including an explicit 'north',
// same as the previous hardcoded fallback below) always wins regardless
// of what's passed here. This is the distinction that matters: reading
// localStorage.getItem() as null (never set) is NOT the same case as it
// returning the literal string 'north' (a user, or a previous default,
// explicitly chose it) - collapsing both into one ternary (as this used
// to) is exactly what would silently override a real NORTH preference
// the moment defaultMode ever became something other than 'north'.
function loadStoredCompassMode(defaultMode: CompassMode = 'north'): CompassMode {
  if (typeof window === 'undefined') return defaultMode
  try {
    const stored = window.localStorage.getItem(COMPASS_MODE_STORAGE_KEY)
    if (stored === 'north' || stored === 'runway') return stored
    return defaultMode
  } catch {
    return defaultMode
  }
}

// hasActiveRunwayData: whether the caller currently has a real heading to
// rotate toward - CompassPanel.tsx passes opsPanel.activeRunwayEnd !== '',
// RunwaysPage.tsx passes whether that same live activeRunwayEnd matches
// either end of the runway currently being edited/previewed. Keeping the
// raw stored preference separate from what's actually applied means a
// user who taps RUNWAY before that data is available still has that
// intent remembered - the moment it does become available, the dial
// starts rotating automatically with no need to tap the button again.
// defaultMode: passed straight through to loadStoredCompassMode's own
// first-load-only fallback (see that function's own comment) - defaults
// to 'north' so every existing caller (every TV-dashboard template,
// RunwaysPage.tsx) is completely unaffected by this param's existence.
// Only CompassPanel.tsx's own initialCompassMode prop (PilotViewPage.tsx
// passing 'runway') ever supplies something else.
export function useCompassMode(
  hasActiveRunwayData: boolean,
  defaultMode: CompassMode = 'north'
): {
  compassMode: CompassMode
  effectiveCompassMode: CompassMode
  showNoRunwayNotice: boolean
  handleCompassModeChange: (next: CompassMode) => void
} {
  const [compassMode, setCompassMode] = useState<CompassMode>(() => loadStoredCompassMode(defaultMode))

  function handleCompassModeChange(next: CompassMode) {
    setCompassMode(next)
    try {
      window.localStorage.setItem(COMPASS_MODE_STORAGE_KEY, next)
    } catch {
      // Private browsing / storage disabled - the toggle still works for
      // this session, it just won't be remembered on the next visit.
    }
  }

  const effectiveCompassMode: CompassMode = compassMode === 'runway' && hasActiveRunwayData ? 'runway' : 'north'
  const showNoRunwayNotice = compassMode === 'runway' && !hasActiveRunwayData

  return { compassMode, effectiveCompassMode, showNoRunwayNotice, handleCompassModeChange }
}

// The two buttons only, as a fragment - deliberately no wrapping element,
// so a caller using justify-between across a wider row (CompassPanel.tsx)
// gets these as direct, spreadable flex children, while a caller that
// just wants them sitting together (RunwaysPage.tsx) can wrap this in its
// own simple gap row. Styling copied verbatim from CompassPanel.tsx's own
// pre-extraction buttons - active vs inactive is text colour alone
// (white vs slate-400), not a background fill, tuned there against real
// /pilot renders.
export function CompassModeButtons({
  effectiveCompassMode,
  onChange,
}: {
  effectiveCompassMode: CompassMode
  onChange: (next: CompassMode) => void
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={() => onChange('north')}
        className={`rounded-xl border border-slate-700 px-[20px] py-[7px] text-[17px] font-bold uppercase tracking-widest transition ${
          effectiveCompassMode === 'north' ? 'text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        North
      </button>
      <button
        type="button"
        onClick={() => onChange('runway')}
        className={`rounded-xl border border-slate-700 px-[20px] py-[7px] text-[17px] font-bold uppercase tracking-widest transition ${
          effectiveCompassMode === 'runway' ? 'text-white' : 'text-slate-400 hover:text-white'
        }`}
      >
        Runway
      </button>
    </>
  )
}

// Same fallback text CompassPanel.tsx always showed - stays visible for
// as long as RUNWAY is the stored preference but there's no real heading
// to rotate toward yet, disappears on its own the moment data becomes
// available (see useCompassMode's own comment on effectiveCompassMode).
export function CompassModeNotice({ show }: { show: boolean }): JSX.Element | null {
  if (!show) return null
  return <div className="text-xs font-semibold text-amber-400">No runway data available</div>
}
