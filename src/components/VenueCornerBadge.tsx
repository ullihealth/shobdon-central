interface VenueCornerBadgeProps {
  airfieldName?: string | null
  logoUrl?: string | null
  // Migration 0039 (Screens Design's Branding tab) - this badge's own
  // 'cafe' brandDisplay slice, independent of Header.tsx's 'main' slice.
  // Both default true - unchanged from today's unconditional "always
  // show both" behaviour for any caller not yet passing these. See
  // Header.tsx's own comment for why this exists: a real club logo
  // (Shobdon's own) often already has the club name baked into the
  // artwork, making the separate text label next to it redundant/
  // visually cluttered rather than an actual CSS overlap.
  showLogo?: boolean
  showName?: boolean
  nameFontSize?: 'sm' | 'md' | 'lg' | 'xl'
}

// 'md' is exactly this component's own previous hardcoded text-sm -
// unchanged default. No responsive sm: breakpoint like Header.tsx's own
// scale (NAME_FONT_SIZE_CLASSES there) - this badge only ever renders
// on a fixed-size café display screen, never a narrow admin viewport.
const NAME_FONT_SIZE_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-2xl',
}

// Café Template's small fixed corner element - logo + name only, not
// part of the ticker rotation. Deliberately NOT Header.tsx itself: that
// component also carries the clock, weather-status slot, and nav-link
// behaviour, none of which belong floating in a corner. Reuses the same
// robust logo-sizing convention Header.tsx established (shrink-0 fixed
// height + object-contain, never object-cover/fixed width+height) so an
// odd-aspect-ratio logo still displays without distortion here too.
export default function VenueCornerBadge({
  airfieldName,
  logoUrl,
  showLogo = true,
  showName = true,
  nameFontSize = 'md',
}: VenueCornerBadgeProps): JSX.Element {
  return (
    <div className="flex max-w-[220px] items-center gap-2 rounded-xl border border-border bg-panel/90 px-3 py-2 shadow-lg shadow-slate-950/30">
      {showLogo && logoUrl && (
        <div className="h-8 max-w-[80px] shrink-0">
          <img src={logoUrl} alt="" className="h-full w-full object-contain object-left" />
        </div>
      )}
      {showName && (
        <div className={`truncate font-black uppercase tracking-wide text-primary ${NAME_FONT_SIZE_CLASSES[nameFontSize]}`}>
          {airfieldName || 'AIRFIELD CENTRAL'}
        </div>
      )}
    </div>
  )
}
