export interface MediaLibraryFile {
  id: string
  filename: string
  mediaType: 'image' | 'mp4' | 'pdf'
  sizeBytes: number
  mp4DurationSeconds: number | null
  uploadedAt: string
  url: string | null
}

export interface CarouselSlot {
  slotNumber: number
  enabled: boolean
  mediaType: 'image' | 'mp4' | 'pdf' | 'webcam'
  durationSeconds: number
  mediaLibraryId: string | null
  cameraSlotNumber: number | null
  // 'fill' = object-fit: cover (crops to fill the box); 'contain' =
  // object-fit: contain (always shows the whole image/video, letterboxed
  // if the aspect ratio doesn't match). Only meaningful for image/mp4 -
  // webcam/pdf are iframes, which object-fit doesn't apply to.
  fitMode: 'fill' | 'contain'
}
