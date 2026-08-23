// Single source of truth for rendering a carousel slot's visual content -
// crop, rotation, brightness, fitMode, and the optional footer banner are
// ALL applied here via CSS only, never by touching the uploaded file in
// R2. Shared verbatim between MediaPanel.tsx (the live public dashboard)
// and MediaManagerPage.tsx (the /media-manager live preview while
// editing), so what an editor sees while adjusting a slot is a genuine
// match for what goes live - not a similar-looking approximation.
import { useEffect, useRef, useState } from 'react'
import type { CropRect } from '../../types/mediaLibrary'
import { AIRFIELD_TIMEZONE, GYROPEDIA_DEPARTURES_URL } from '../../config/publicApi'

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
export function zoomPanTransformStyle(crop: CropRect): React.CSSProperties {
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

// UK gyroplane departures/arrivals - functions/api/public/
// gyropedia-departures.ts is the single source of truth for the data
// (fetch/parse/cache/last-known-good all live there); this component is
// just one consumer of that endpoint's plain JSON, same separation a
// future mobile app or other client could reuse directly. Polls its own
// backend every POLL_INTERVAL_MS independently of the endpoint's own
// developer-configurable KV freshness window - slots stay mounted
// continuously once the carousel loads (see this file's own isActive
// comment above), so without its own refetch a gyropedia slot would
// otherwise show whatever it first loaded indefinitely. Asking our own
// same-origin, already-cached endpoint this often is cheap regardless
// of how rarely it actually re-fetches Gyropedia itself.
const GYROPEDIA_POLL_INTERVAL_MS = 60_000

interface GyropediaPlace {
  place: string
  time: string
}

interface GyropediaRow {
  status: string
  out: GyropediaPlace
  in: GyropediaPlace
  aircraft: string
  type: string
  persons: string
  remark: string
}

// Same clamp(min, viewport-relative, max) technique CompassPanel.tsx/
// LeftInfoPanel.tsx already use for their own readouts - fluid with the
// actual display's dimensions rather than a fixed pixel size, since this
// panel needs to adapt to whichever venue device it ends up on.
const GYROPEDIA_HEADER_FONT = 'clamp(7px, 1.3vh, 14px)'
const GYROPEDIA_CELL_FONT = 'clamp(8px, 1.6vh, 17px)'
const GYROPEDIA_LAST_UPDATED_FONT = 'clamp(6px, 1.1vh, 12px)'

// Scheduled/Landed/Flying are the statuses confirmed against a real
// pull (see gyropedia-departures.ts's own top comment) - any other
// status Gyropedia might use in future falls back to the plain/neutral
// colour below rather than being hidden or breaking.
//
// Flying green matches gyropedia.com's own CSS (.F { background-color:
// green }), confirmed against the real page. Landed blue does NOT match
// their own convention - their .L/.C/.departed classes are actually
// black background with yellow text, not blue at all - implemented as
// blue anyway per explicit instruction, flagging the discrepancy here
// rather than silently "correcting" it to yellow-on-black.
const STATUS_COLOUR: Record<string, string> = {
  Scheduled: 'text-slate-300',
  Landed: 'text-accent-sky-400',
  Flying: 'text-status-good',
}

function GyropediaLastUpdated({ fetchedAt }: { fetchedAt: string | null }): JSX.Element | null {
  if (!fetchedAt) return null
  const timeString = new Date(fetchedAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: AIRFIELD_TIMEZONE,
  })
  return (
    <div
      className="absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 font-medium text-muted-300"
      style={{ fontSize: GYROPEDIA_LAST_UPDATED_FONT }}
    >
      Last updated {timeString}
    </div>
  )
}

function GyropediaPanel(): JSX.Element {
  const [rows, setRows] = useState<GyropediaRow[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    function load() {
      fetch(GYROPEDIA_DEPARTURES_URL)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          setRows(Array.isArray(data.rows) ? data.rows : [])
          setFetchedAt(typeof data.fetchedAt === 'string' ? data.fetchedAt : null)
        })
        .catch(() => {})
    }

    load()
    const interval = window.setInterval(load, GYROPEDIA_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-950 p-2 text-white">
      <div className="mb-1 flex-shrink-0 text-center font-bold uppercase tracking-widest text-primary" style={{ fontSize: GYROPEDIA_HEADER_FONT }}>
        Gyropedia Departures/Arrivals — UK
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-400" style={{ fontSize: GYROPEDIA_CELL_FONT }}>
            No UK flights currently listed
          </div>
        ) : (
          <table className="w-full border-collapse" style={{ fontSize: GYROPEDIA_CELL_FONT }}>
            <thead>
              <tr className="text-muted-400" style={{ fontSize: GYROPEDIA_HEADER_FONT }}>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">Status</th>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">Out</th>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">In</th>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">Aircraft</th>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">Type</th>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">Persons</th>
                <th className="px-1 py-0.5 text-left font-semibold uppercase">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-800">
                  <td className={`px-1 py-0.5 font-semibold ${STATUS_COLOUR[row.status] ?? 'text-slate-300'}`}>{row.status}</td>
                  <td className="px-1 py-0.5">
                    {row.out.place}
                    {row.out.time ? <span className="text-muted-400"> {row.out.time}</span> : null}
                  </td>
                  <td className="px-1 py-0.5">
                    {row.in.place}
                    {row.in.time ? <span className="text-muted-400"> {row.in.time}</span> : null}
                  </td>
                  <td className="px-1 py-0.5">{row.aircraft}</td>
                  <td className="px-1 py-0.5">{row.type}</td>
                  <td className="px-1 py-0.5">{row.persons}</td>
                  <td className="px-1 py-0.5">{row.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <GyropediaLastUpdated fetchedAt={fetchedAt} />
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
//
// shouldLoad (staged-preload round) - defaults true for the same reason
// isActive does (MediaManagerPage.tsx's single-slot preview has nothing
// else to gate against). MediaPanel.tsx's carousel is again the one real
// caller that passes it explicitly, false for every mp4 slot except the
// currently-active one (and the next one due up, for a smooth
// transition) - see that file's own comment for why. Only the mp4 case
// below actually reads it: gates the <video>'s own `src` so a dormant
// slot has genuinely nothing to fetch, rather than trying to express
// "don't load yet" via the `preload` attribute, whose semantics on an
// already-mounted element are inconsistent across browsers once `src`
// is already set. Every other content type ignores this prop entirely -
// images/webcam/gyropedia were never the source of the bandwidth
// problem this exists to fix.
//
// onReadyStateChange (same round) - fires once when this slot's video
// becomes playable-through (canplaythrough) or fails to load (error),
// for MediaPanel.tsx's own buffering-gate orchestration to advance past
// it. undefined for every caller except the one specific slot MediaPanel
// is currently waiting on during that gate - harmless no-op the rest of
// the time (the effect below just no-ops when this prop is undefined).
export default function MediaSlotRenderer({
  slot,
  isActive = true,
  shouldLoad = true,
  onReadyStateChange,
}: {
  slot: MediaSlotVisual
  isActive?: boolean
  shouldLoad?: boolean
  onReadyStateChange?: (state: 'ready' | 'error') => void
}): JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Ref-based play/pause, not the autoPlay attribute - autoPlay only
  // fires once on mount, which is exactly wrong now that mp4 slots stay
  // mounted continuously: every slot's video would start playing the
  // moment carouselSlots first loads, regardless of which one is
  // actually active. Driving play()/pause() off isActive instead means
  // exactly one video plays at a time (whichever slot is current),
  // deterministically, on every activeIndex change - not just on mount.
  //
  // Explicit "restart from 0" on reactivation (currentTime = 0 right
  // before play()) - a prior version of this comment argued this was
  // unnecessary since "loop is already on, so resuming mid-loop reads
  // the same as a fresh loop." That reasoning was wrong: the carousel's
  // own away-timer (MediaPanel.tsx's scheduleNext, using
  // mp4DurationSeconds - deliberately auto-detected from the file's own
  // real length on upload, see MediaLibraryPage.tsx) switches away at
  // very close to the video's own natural end, so pause() very often
  // freezes currentTime within a fraction of a second of the clip's
  // true duration - confirmed live on both Shobdon's dashboard carousel
  // and a café tenant's carousel via direct instrumentation, e.g. one
  // capture paused at 7.509s of a 7.567s clip (99.2% through). On the
  // NEXT activation, play() then resumed from that frozen near-end
  // point for a brief instant before the native loop wraparound fired -
  // exactly the reported "flashes a frame near the end, then restarts"
  // symptom. Resetting currentTime to 0 here means every reactivation
  // starts from frame 0 with no stale prior position to flash.
  // Declared before the early return below (not after) so hook call
  // order stays unconditional across renders, per React's own rules -
  // harmless no-op on the non-mp4/no-videoRef branches, since the
  // effect just no-ops when videoRef.current is null.
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (isActive) {
      videoEl.currentTime = 0
      videoEl.play().catch(() => {})
    } else {
      videoEl.pause()
    }
  }, [isActive])

  // Staged-preload round - reports this slot's own load outcome back to
  // MediaPanel.tsx's buffering gate. canplaythrough (enough buffered,
  // relative to the browser's own download-rate estimate, to expect
  // playback through to the end without stalling) is the standard
  // "ready" signal for exactly this purpose - it does NOT require the
  // video to actually be playing, only for `src` to be set, which is
  // exactly what shouldLoad drives below. error covers an unreachable/
  // corrupt file. Both are terminal for this slot's own gate wait - no
  // guard needed against firing after the slot's already been resolved,
  // since MediaPanel stops passing a callback once it moves on (this
  // effect's own cleanup then removes these listeners).
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl || !onReadyStateChange) return
    function handleReady() {
      onReadyStateChange?.('ready')
    }
    function handleError() {
      onReadyStateChange?.('error')
    }
    videoEl.addEventListener('canplaythrough', handleReady)
    videoEl.addEventListener('error', handleError)
    return () => {
      videoEl.removeEventListener('canplaythrough', handleReady)
      videoEl.removeEventListener('error', handleError)
    }
  }, [onReadyStateChange])

  // gyropedia/reserved have no resolvedUrl at all - gyropedia's content
  // comes from GyropediaPanel's own fetch of the shared public endpoint
  // below, not a per-slot URL; reserved (Reserved Owner Slots & Time
  // Budget round) is the "owner hasn't assigned real content to this
  // slot yet" placeholder - see publicConfig.ts's own comment on when a
  // slot resolves to this mediaType instead of real content.
  if (!slot.resolvedUrl && slot.mediaType !== 'webcam' && slot.mediaType !== 'gyropedia' && slot.mediaType !== 'reserved') return null

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
      // src itself (not the `preload` attribute) is the actual staged-
      // preload gate - see this component's own shouldLoad comment
      // above for why. key stays keyed on resolvedUrl, not shouldLoad,
      // so the same DOM node/videoRef persists across a false->true
      // transition (a normal src-attribute update, not a remount) -
      // exactly what lets the browser start a fresh, uninterrupted load
      // the moment shouldLoad flips true.
      content = (
        <video
          ref={videoRef}
          key={slot.resolvedUrl}
          src={shouldLoad ? slot.resolvedUrl ?? undefined : undefined}
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
    case 'website':
      // Generic embedded external webpage (café "Website" slot type,
      // migration 0093) - resolvedUrl IS the tenant-supplied URL
      // directly (publicConfig.ts/resolveSlotVisual both map externalUrl
      // straight through, no lookup needed the way a file/camera source
      // would require). sandbox intentionally still allows scripts and
      // same-origin - a plain read-only embed (no allow-popups, no allow-
      // forms, no allow-top-navigation) for arbitrary tenant-supplied
      // URLs, sensible default for something nobody but the tenant
      // themselves configured. Many real sites set X-Frame-Options/
      // frame-ancestors and simply refuse to render here at all - that's
      // the site's own choice, not something sandboxing can work around,
      // and failing to blank/broken (never a crash) is the correct,
      // expected outcome for those - see this slot type's own inline UI
      // hint (CarouselSlotEditor.tsx).
      content = (
        <iframe
          src={slot.resolvedUrl ?? undefined}
          className="h-full w-full"
          style={{ border: 0 }}
          sandbox="allow-scripts allow-same-origin"
          title="Embedded website"
        />
      )
      break
    case 'gyropedia':
      content = <GyropediaPanel />
      break
    case 'reserved':
      // Simple branded placeholder, matching the existing dark theme -
      // an unsold/unassigned owner-reserved slot (slots 5/8/12) still
      // occupies its full 10s in the rotation rather than being skipped,
      // so viewers see a deliberate "this space is available" message
      // instead of a blank/black slide.
      content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 text-slate-500">
          <span className="text-xs font-bold uppercase tracking-[0.3em]">Media Reserved</span>
          <span className="text-[11px] tracking-wide">Airfield Central</span>
        </div>
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
