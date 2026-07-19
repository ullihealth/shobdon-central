import type { SlideRecipe } from './slideRecipe'

export interface MediaLibraryFile {
  id: string
  filename: string
  mediaType: 'image' | 'mp4' | 'pdf'
  sizeBytes: number
  mp4DurationSeconds: number | null
  uploadedAt: string
  url: string | null
  // Non-null only for a flattened PNG created by the /media-manager
  // slide composer - lets the library list offer "Edit Slide" instead
  // of (or alongside) Delete. Null for every normal upload.
  slideRecipe: SlideRecipe | null
  // Null = the virtual "Uncategorized" bucket, not a real media_folders
  // row - every file defaults here until explicitly moved.
  folderId: string | null
  // Which carousel(s) this asset can be picked from - Dashboard Manager's
  // Source dropdown shows 'dashboard'|'both', Cafe Media's shows
  // 'cafe'|'both'. Existing files migrated to 'dashboard' (migration
  // 0037) so nothing already assigned to a dashboard slot silently
  // becomes unavailable there.
  usableOn: 'dashboard' | 'cafe' | 'both'
  // Auto-detected from the file's actual pixel dimensions at upload time
  // (landscape/square -> '16:9', portrait -> '9:16') where possible,
  // editable afterward on the Media Library page. Used to further filter
  // a café slot's Source options when that slot's zone is 'left'/'right'
  // (split-pane wants portrait-shaped assets) - see
  // CarouselSlotEditor.tsx's filterAssetsForScreen(). Existing files
  // migrated to '16:9' (migration 0037) - no width/height was ever
  // stored for them, so genuine detection isn't possible retroactively;
  // '16:9' matches what every existing dashboard slot was actually
  // designed for.
  orientation: '16:9' | '9:16' | 'both'
}

export interface MediaFolder {
  id: string
  name: string
  createdAt: string
  fileCount: number
}

// Percentage sub-rect of the source image/video to display - x/y are the
// top-left corner, width/height the size of the visible slice, all 0-100.
// {x:0,y:0,width:100,height:100} is the full source (no crop).
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
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
  // Non-destructive appearance adjustments, applied via CSS at render
  // time (MediaSlotRenderer.tsx) - the uploaded file itself is never
  // touched. All default to "no adjustment" values.
  cropRect: CropRect
  rotationDegrees: number
  brightnessPercent: number
  // Optional footer banner strip - only rendered when bannerText is
  // non-empty. bannerFontSize uses its own banner-specific size scale
  // (MediaSlotRenderer.tsx's BANNER_SIZE_CLASSES), not NOTAMS' -
  // NOTAMS' scale was tuned for a narrow side-panel card and reads as
  // tiny on a full-width dashboard banner.
  bannerText: string
  bannerOpacity: number
  bannerFontSize: 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  // Café Template's split-pane assignment - 'both' (default) shows in
  // both zones when split, and normally in full-16:9 mode. Ignored by
  // every other template.
  zone: 'both' | 'left' | 'right'
}
