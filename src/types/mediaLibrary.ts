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
}
