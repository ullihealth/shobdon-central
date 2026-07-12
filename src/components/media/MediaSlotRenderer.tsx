// Single source of truth for rendering a carousel slot's visual content -
// crop, rotation, brightness, fitMode, and the optional footer banner are
// ALL applied here via CSS only, never by touching the uploaded file in
// R2. Shared verbatim between MediaPanel.tsx (the live public dashboard)
// and MediaManagerPage.tsx (the /media-manager live preview while
// editing), so what an editor sees while adjusting a slot is a genuine
// match for what goes live - not a similar-looking approximation.
import type { CropRect } from '../../types/mediaLibrary'

export interface MediaSlotVisual {
  mediaType: string
  resolvedUrl: string | null
  fitMode: string
  cropRect: CropRect
  rotationDegrees: number
  brightnessPercent: number
  bannerText: string
  bannerOpacity: number
  bannerFontSize: 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
}

// Deliberately NOT reusing NOTAMS' sm/md/lg -> text-base/lg/xl scale
// (RightInfoPanel.tsx's SIZE_CLASSES) - that scale was tuned for a
// narrow side-panel card, and even its 'lg' (20px) reads as tiny
// against a ~975px-wide full-bleed banner on a large dashboard. This is
// a separate, banner-specific scale, roughly 1.5-2x NOTAMS' pixel
// sizes at each tier, with two extra tiers ('xl'/'xxl') for genuinely
// large captions. BANNER_HEIGHT_CLASSES grows alongside it so larger
// text never clips the strip.
const BANNER_SIZE_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl' | 'xxl', string> = {
  sm: 'text-lg', // 18px
  md: 'text-2xl', // 24px
  lg: 'text-3xl', // 30px
  xl: 'text-4xl', // 36px
  xxl: 'text-5xl', // 48px
}

const BANNER_HEIGHT_CLASSES: Record<'sm' | 'md' | 'lg' | 'xl' | 'xxl', string> = {
  sm: 'h-10', // 40px
  md: 'h-12', // 48px
  lg: 'h-14', // 56px
  xl: 'h-16', // 64px
  xxl: 'h-20', // 80px
}

// Crop is expressed as a percentage sub-rect of the source [x,y,w,h].
// To show only that slice, the underlying image/video is rendered at a
// scale of (100/w)% x (100/h)% inside an overflow:hidden viewport, and
// shifted so the crop's top-left corner lands at the viewport's origin.
// Deliberate scope decision: the cropped slice always fills the crop
// viewport via object-fit:cover (never letterboxed) - fitMode's
// contain/fill distinction still applies to how that filled slice sits
// in the outer 16:9 box, but a manually-chosen crop rectangle is always
// presented "cover"-style within its own viewport, matching standard
// photo-crop-tool UX (once you've drawn a crop box, its contents fill
// the frame).
function cropTransformStyle(crop: CropRect): React.CSSProperties {
  const w = Math.max(1, crop.width)
  const h = Math.max(1, crop.height)
  return {
    position: 'absolute',
    left: `${(-100 * crop.x) / w}%`,
    top: `${(-100 * crop.y) / h}%`,
    width: `${10000 / w}%`,
    height: `${10000 / h}%`,
  }
}

const IDENTITY_CROP: CropRect = { x: 0, y: 0, width: 100, height: 100 }

function isIdentityCrop(crop: CropRect): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 100 && crop.height === 100
}

function BannerOverlay({
  text,
  opacity,
  fontSize,
}: {
  text: string
  opacity: number
  fontSize: 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
}): JSX.Element | null {
  if (!text.trim()) return null
  return (
    <div
      className={`absolute inset-x-0 bottom-0 flex items-center justify-center px-4 text-center font-semibold text-white ${BANNER_HEIGHT_CLASSES[fontSize]} ${BANNER_SIZE_CLASSES[fontSize]}`}
      style={{ backgroundColor: `rgba(0, 0, 0, ${Math.max(0, Math.min(100, opacity)) / 100})` }}
    >
      <span className="truncate">{text}</span>
    </div>
  )
}

// Renders one carousel slot's visual content into whatever box the
// caller provides (both call sites use the identical aspect-video 16:9
// box) - fills it edge-to-edge, no internal padding of its own.
export default function MediaSlotRenderer({ slot }: { slot: MediaSlotVisual }): JSX.Element | null {
  if (!slot.resolvedUrl && slot.mediaType !== 'webcam') return null

  const crop = slot.cropRect ?? IDENTITY_CROP
  const hasCrop = !isIdentityCrop(crop) && (slot.mediaType === 'image' || slot.mediaType === 'mp4')
  const hasRotation = slot.rotationDegrees % 360 !== 0
  const filterStyle: React.CSSProperties =
    slot.brightnessPercent !== 100 ? { filter: `brightness(${slot.brightnessPercent}%)` } : {}

  // When a crop is active, the image/video is rendered at wrapper scale
  // (see cropTransformStyle) and MUST use object-fit:cover there, always
  // - the wrapper is a scaled virtual "full canvas", not the final box,
  // so letting fitMode's contain/fill apply at that inner layer would
  // letterbox the wrong thing. fitMode only governs how content sits in
  // the outer 16:9 box, which only matters when there's no crop.
  const objectFitClass = hasCrop ? 'object-cover' : slot.fitMode === 'fill' ? 'object-cover' : 'object-contain'

  let content: JSX.Element | null = null
  switch (slot.mediaType) {
    case 'webcam':
      if (!slot.resolvedUrl) return null
      content = (
        <iframe
          src={slot.resolvedUrl}
          className="h-full w-full"
          style={{ border: 0, ...filterStyle }}
          allow="autoplay"
          allowFullScreen
          title="Aeroclub webcam"
        />
      )
      break
    case 'image':
      content = (
        <img
          src={slot.resolvedUrl ?? undefined}
          alt=""
          className={`h-full w-full ${objectFitClass}`}
          style={filterStyle}
        />
      )
      break
    case 'mp4':
      content = (
        <video
          key={slot.resolvedUrl}
          src={slot.resolvedUrl ?? undefined}
          className={`h-full w-full ${objectFitClass}`}
          style={filterStyle}
          autoPlay
          muted
          loop
          playsInline
        />
      )
      break
    case 'pdf':
      if (!slot.resolvedUrl) return null
      content = (
        <iframe
          src={slot.resolvedUrl}
          className="h-full w-full bg-white"
          style={{ border: 0, ...filterStyle }}
          title="Document"
        />
      )
      break
    default:
      return null
  }

  // Crop/rotate only make visual sense for raster content (image/mp4);
  // webcam/pdf still render (with brightness/banner still applicable),
  // just without the crop-viewport/rotation wrapper divs, since an
  // iframe's embedded page content isn't a "source image" with pixels
  // to crop into - wrapping it wouldn't do anything a plain box doesn't
  // already do, so it's skipped rather than added as dead markup.
  const supportsCropRotate = slot.mediaType === 'image' || slot.mediaType === 'mp4'

  const inner = hasCrop ? (
    <div className="relative h-full w-full overflow-hidden">
      <div style={cropTransformStyle(crop)}>{content}</div>
    </div>
  ) : (
    content
  )

  const rotated =
    supportsCropRotate && hasRotation ? (
      <div
        className="relative h-full w-full overflow-hidden"
        style={{ transform: `rotate(${slot.rotationDegrees}deg)` }}
      >
        {inner}
      </div>
    ) : (
      inner
    )

  return (
    <div className="relative h-full w-full overflow-hidden">
      {rotated}
      <BannerOverlay text={slot.bannerText} opacity={slot.bannerOpacity} fontSize={slot.bannerFontSize} />
    </div>
  )
}
