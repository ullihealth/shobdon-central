import type { MediaItem } from '../types/media'

// Shown whenever a tenant has no carousel slots enabled and no webcam
// configured (MediaPanel.tsx's own fallback tier). Was a hardcoded
// Shobdon marketing image ("Trial Flights at Shobdon Airfield") until
// the pre-onboarding branding audit replaced it with the generic
// 'empty' state - a brand-new tenant's dashboard showing another
// airfield's real promotional photo was the exact problem being fixed.
//
// Now points at the public marketing landing page's own hero image
// (public/images/landing-page-runway.jpg, LandingPage.tsx's own asset)
// instead of either of those - AirfieldCentral's own product imagery,
// not any specific real tenant's photo, so it's safe to show for any
// unconfigured tenant without being "someone else's airfield." Chosen
// over the plain 'empty' text state per this round's own request - a
// branded placeholder image reads better than blank text while a
// tenant hasn't uploaded anything yet.
export const currentMedia: MediaItem = {
  type: 'image',
  src: '/images/landing-page-runway.jpg',
  alt: 'Airfield Central',
}
