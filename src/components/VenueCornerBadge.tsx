interface VenueCornerBadgeProps {
  airfieldName?: string | null
  logoUrl?: string | null
}

// Café Template's small fixed corner element - logo + name only, not
// part of the ticker rotation. Deliberately NOT Header.tsx itself: that
// component also carries the clock, weather-status slot, and nav-link
// behaviour, none of which belong floating in a corner. Reuses the same
// robust logo-sizing convention Header.tsx established (shrink-0 fixed
// height + object-contain, never object-cover/fixed width+height) so an
// odd-aspect-ratio logo still displays without distortion here too.
export default function VenueCornerBadge({ airfieldName, logoUrl }: VenueCornerBadgeProps): JSX.Element {
  return (
    <div className="flex max-w-[220px] items-center gap-2 rounded-xl border border-border bg-panel/90 px-3 py-2 shadow-lg shadow-slate-950/30">
      {logoUrl && (
        <div className="h-8 max-w-[80px] shrink-0">
          <img src={logoUrl} alt="" className="h-full w-full object-contain object-left" />
        </div>
      )}
      <div className="truncate text-sm font-black uppercase tracking-wide text-primary">
        {airfieldName || 'AIRFIELD CENTRAL'}
      </div>
    </div>
  )
}
