// Single source of truth for rendering a carousel slot's visual content -
// crop, rotation, brightness, fitMode, and the optional footer banner are
// ALL applied here via CSS only, never by touching the uploaded file in
// R2. Shared verbatim between MediaPanel.tsx (the live public dashboard)
// and MediaManagerPage.tsx (the /media-manager live preview while
// editing), so what an editor sees while adjusting a slot is a genuine
// match for what goes live - not a similar-looking approximation.
import { useEffect, useRef } from 'react'
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

const IDENTITY_CROP: CropRect = { x: 0, y: 0, width: 100, height: 100 }

// Applied directly to the img/video element itself, ON TOP of its own
// normal object-fit:{fitMode} rendering - NOT via a separate wrapper
// that swaps to a different object-fit strategy. This is what makes
// zoom continuous: at the identity crop (100/100, x=y=0) this resolves
// to `scale(1) translate(0%, 0%)`, a true no-op that's pixel-identical
// to fitMode's own unmodified rendering (whether that's letterboxed
// 'contain' or filled 'cover'). As the crop's width/height shrink
// (zoom increases), the ALREADY-fitted image scales up smoothly from
// wherever fitMode left it - so a 'contain'-fitted image that starts
// letterboxed will progressively grow into and past its own letterbox
// bars as zoom increases, with no jump at any point, until eventually
// it fills the box and keeps zooming further. (A prior version forced
// object-fit:cover the instant ANY crop was non-identity, which caused
// a hard jump from "letterboxed" to "fully cropped" between 100% and
// 101% zoom - this replaces that with a single continuous formula.)
//
// Pan (crop.x/crop.y) is converted to a translate that's proportional
// to how much scale "room" exists - so pan has zero effect at 100%
// zoom (scale=1) and smoothly gains effect as zoom increases, matching
// the same "no discontinuity" requirement.
function zoomPanTransformStyle(crop: CropRect): React.CSSProperties {
  const width = crop.width > 0 ? crop.width : 100
  const height = crop.height > 0 ? crop.height : 100
  const scale = 100 / Math.max(1, Math.min(width, height))
  if (scale === 1) return {}

  const marginX = 100 - width
  const marginY = 100 - height
  const fracX = marginX > 0.001 ? crop.x / marginX : 0.5
  const fracY = marginY > 0.001 ? crop.y / marginY : 0.5
  const panX = (fracX - 0.5) * 2 // -1 (leftmost) .. 0 (centered) .. 1 (rightmost)
  const panY = (fracY - 0.5) * 2

  // translate() percentages resolve against the element's own
  // (unscaled) box and are applied before scale() amplifies them (CSS
  // transform functions compose right-to-left) - so dividing by scale
  // here means the FINAL visual displacement is exactly
  // panX * (scale-1) * 50%, i.e. it exactly reaches the available
  // margin at panX = ±1 and is 0 at panX = 0, for any scale.
  const txPercent = (-panX * (scale - 1) * 50) / scale
  const tyPercent = (-panY * (scale - 1) * 50) / scale

  return { transform: `scale(${scale}) translate(${txPercent}%, ${tyPercent}%)` }
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
//
// isActive defaults to true so MediaManagerPage.tsx's single-slot preview
// (never passes it - there's no carousel there, just one slot being
// edited) keeps behaving exactly as before. MediaPanel.tsx's carousel is
// the one real caller that passes it explicitly: since all slots now stay
// mounted simultaneously (see MediaPanel.tsx) rather than only the
// active one, an mp4 slot needs to know whether IT is the one currently
// visible so its own video element can pause while hidden instead of
// playing/decoding off-screen indefinitely.
export default function MediaSlotRenderer({ slot, isActive = true }: { slot: MediaSlotVisual; isActive?: boolean }): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Ref-based play/pause, not the autoPlay attribute - autoPlay only
  // fires once on mount, which is exactly wrong now that mp4 slots stay
  // mounted continuously: every slot's video would start playing the
  // moment carouselSlots first loads, regardless of which one is
  // actually active. Driving play()/pause() off isActive instead means
  // exactly one video plays at a time (whichever slot is current),
  // deterministically, on every activeIndex change - not just on mount.
  // No explicit "restart from 0" on reactivation: pause() leaves
  // currentTime where it was, so play() simply resumes from there, the
  // same behaviour every native <video> gives you for free - resetting
  // to 0 would need an extra currentTime assignment for no clear benefit
  // (loop is already on, so a slide left mid-loop resuming mid-loop
  // reads the same as a fresh loop to a viewer). Declared before the
  // early return below (not after) so hook call order stays unconditional
  // across renders, per React's own rules - harmless no-op on the
  // non-mp4/no-videoRef branches, since the effect just no-ops when
  // videoRef.current is null.
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (isActive) {
      videoEl.play().catch(() => {})
    } else {
      videoEl.pause()
    }
  }, [isActive])

  if (!slot.resolvedUrl && slot.mediaType !== 'webcam') return null

  const crop = slot.cropRect ?? IDENTITY_CROP
  const hasRotation = slot.rotationDegrees % 360 !== 0
  const filterStyle: React.CSSProperties =
    slot.brightnessPercent !== 100 ? { filter: `brightness(${slot.brightnessPercent}%)` } : {}

  // Originally image/mp4 only - webcam was excluded on the reasoning that
  // an iframe's embedded page "isn't a source image with pixels to zoom
  // into." That's true in the sense that zooming a webcam iframe doesn't
  // reveal extra native-resolution detail the way zooming a real image
  // does, but the SAME scale()/translate() CSS technique still works on
  // an iframe exactly as it does on any element: it magnifies and pans
  // within the iframe's own already-rendered box (video plus rtsp.me's
  // own overlay chrome, moving together), clipped by this component's
  // own overflow-hidden wrapper - which is exactly "zoom and reposition
  // the display" from a viewer's perspective, just not a crop into
  // higher-resolution source pixels. Added per an explicit ask to be
  // able to reposition/zoom the webcam view the same way other slots
  // already can. pdf stays excluded - zooming a document page wasn't
  // asked for and doesn't have an obvious use case here.
  const supportsCropRotate = slot.mediaType === 'image' || slot.mediaType === 'mp4' || slot.mediaType === 'webcam'
  const objectFitClass = slot.fitMode === 'fill' ? 'object-cover' : 'object-contain'
  const mediaStyle: React.CSSProperties = supportsCropRotate
    ? { ...filterStyle, ...zoomPanTransformStyle(crop) }
    : filterStyle

  let content: JSX.Element | null = null
  switch (slot.mediaType) {
    case 'webcam':
      if (!slot.resolvedUrl) return null
      content = (
        <iframe
          src={slot.resolvedUrl}
          className="h-full w-full"
          style={{ border: 0, ...mediaStyle }}
          allow="autoplay"
          allowFullScreen
          title="Aeroclub webcam"
        />
      )
      break
    case 'image':
      content = (
        <img src={slot.resolvedUrl ?? undefined} alt="" className={`h-full w-full ${objectFitClass}`} style={mediaStyle} />
      )
      break
    case 'mp4':
      content = (
        <video
          ref={videoRef}
          key={slot.resolvedUrl}
          src={slot.resolvedUrl ?? undefined}
          className={`h-full w-full ${objectFitClass}`}
          style={mediaStyle}
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
          style={{ border: 0, ...mediaStyle }}
          title="Document"
        />
      )
      break
    default:
      return null
  }

  const rotated =
    supportsCropRotate && hasRotation ? (
      <div
        className="relative h-full w-full overflow-hidden"
        style={{ transform: `rotate(${slot.rotationDegrees}deg)` }}
      >
        {content}
      </div>
    ) : (
      content
    )

  return (
    <div className="relative h-full w-full overflow-hidden">
      {rotated}
      <BannerOverlay text={slot.bannerText} opacity={slot.bannerOpacity} fontSize={slot.bannerFontSize} />
    </div>
  )
}
