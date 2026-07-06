export interface ImageMediaItem {
  type: 'image'
  src: string
  alt: string
}

export interface EmptyMediaItem {
  type: 'empty'
}

// Future variants (slideshow, webcam, video, sponsor, emergency) extend this
// union. MediaPanel's renderer is the only place that needs to grow to
// support them - the 16:9 viewport it renders into does not change.
export type MediaItem = ImageMediaItem | EmptyMediaItem
