import type { MediaItem } from '../types/media'

// Shown whenever a tenant has no carousel slots enabled and no webcam
// configured (MediaPanel.tsx's own fallback tier) - was a hardcoded
// Shobdon marketing image ("Trial Flights at Shobdon Airfield"), found
// during the pre-onboarding branding audit: a brand-new, genuinely
// unconfigured tenant's dashboard showed another airfield's real
// promotional photo instead of a generic "not set up yet" state. The
// 'empty' MediaItem type (types/media.ts) already exists exactly for
// this - MediaPanel.tsx's renderMediaContent renders its own neutral
// "Media Panel / Images, webcam, alerts, or slideshow content" text for
// it, so this is reusing an existing generic state, not inventing one.
export const currentMedia: MediaItem = {
  type: 'empty',
}
