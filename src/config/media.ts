import type { MediaItem } from '../types/media'

// No image asset has been supplied yet. Swap this for an ImageMediaItem
// (or a future slideshow/webcam/video/sponsor/emergency item) when one is.
export const currentMedia: MediaItem = { type: 'empty' }
