import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../../types/media'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import MediaSlotRenderer, { type MediaSlotVisual } from './MediaSlotRenderer'

interface CarouselSlotResolved extends MediaSlotVisual {
  slotNumber: number
  durationSeconds: number
  mp4DurationSeconds: number | null
  zone: 'both' | 'left' | 'right'
}

function renderMediaContent(item: MediaItem) {
  switch (item.type) {
    case 'image':
      return <img src={item.src} alt={item.alt} className="h-full w-full object-contain" />
    case 'empty':
      return (
        <div className="space-y-2">
          <div className="text-2xl font-semibold text-primary">Media Panel</div>
          <div className="text-sm text-muted-400">Images, webcam, alerts, or slideshow content</div>
        </div>
      )
  }
}

interface MediaPanelProps {
  item: MediaItem
  // When true, prioritizes video (mp4) carousel content over the full
  // mix - Clubhouse Template 2's "video-forward" media panel. Filters
  // to mp4 slots only when at least one exists; falls back to the full
  // mix otherwise (same graceful-degradation posture as this file's
  // existing webcam/item fallback tiers below). Default false/undefined
  // - every existing caller (Template 1, Café) is completely unaffected.
  preferVideo?: boolean
  // Café Template's split-pane mode - filters carouselSlots to
  // slot.zone === zone || 'both' before the existing cycle/render
  // logic runs, generalizing the exact pattern preferVideo above
  // already established. Default undefined = no filtering (every
  // existing caller, including Café's own full-16:9 mode, unaffected).
  zone?: 'left' | 'right'
  // Fills the panel's ENTIRE container instead of letterboxing to a
  // fixed 16:9 box (the default, below) - Café Template's main content
  // zone spans the whole screen width with no side columns, unlike
  // Clubhouse1/2Template's ~54%/~40% centre column, where a forced 16:9
  // box happens to sit close enough to that column's own proportions
  // that the letterboxing is barely visible. At Café's full width the
  // same fixed-aspect box left a large empty gap (root cause of a
  // reported live layout bug) - `fill` removes the aspect-ratio
  // constraint entirely rather than trying to tune it, so every actual
  // slot's own fitMode (contain/fill, set per-slot in Media Manager)
  // is what determines any letterboxing now, not this wrapper. Default
  // false - every existing caller (Clubhouse1/2Template,
  // CentreDisplayPanel) is completely unaffected.
  fill?: boolean
  // Which of the two independent carousels (migration 0037) this panel
  // reads from - 'dashboard' (default) reads the same public config
  // `carouselSlots` field every existing caller already used before this
  // prop existed; 'cafe' reads the new, separate `cafeCarouselSlots`
  // field instead. Every non-café caller (Template 1, Clubhouse Template
  // 2, CentreDisplayPanel) omits this entirely and is completely
  // unaffected. Independent of `zone` - café's split-pane zone filtering
  // still applies on top of whichever slot source this selects.
  slotSource?: 'dashboard' | 'cafe'
  // Bump this (any value that changes counts - a counter is enough) to
  // force an immediate refetch of the public config this panel renders
  // from. This component otherwise fetches exactly ONCE, on mount, and
  // never again - fine for the real public dashboard (nothing else on
  // that page can change the underlying slots out from under it), but
  // wrong for a caller that ALSO has its own admin editor mutating the
  // same slots on the SAME page (Cafe Media's live preview sits right
  // below its own Carousel Slots section) - without this, a saved slot
  // edit (e.g. a Zone change) is silently invisible in that preview
  // until a full page reload, which read as "the Zone dropdown has no
  // effect" even though the save and the underlying data were both
  // correct. Every existing caller omits this (stays undefined,
  // unchanging) and keeps the original fetch-once-on-mount behaviour.
  refreshSignal?: number
}

export default function MediaPanel({ item, preferVideo, zone, fill, slotSource = 'dashboard', refreshSignal }: MediaPanelProps): JSX.Element {
  // Club-configured live webcam takes priority over item (image/placeholder)
  // whenever it's set - empty string (no webcam configured, or not yet
  // loaded) falls back to item exactly as before. This is the pre-
  // carousel behaviour, kept completely unchanged as the fallback tier
  // below: the carousel only takes over when it actually has at least
  // one enabled slot; a not-yet-configured or fully-disabled carousel
  // falls straight through to this, not a broken empty screen.
  const [webcamUrl, setWebcamUrl] = useState('')
  const [carouselSlots, setCarouselSlots] = useState<CarouselSlotResolved[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return
        const slotOne = data?.cameraSlots?.find((slot: { slot: number; url: string }) => slot.slot === 1)
        if (slotOne?.url) setWebcamUrl(slotOne.url)
        const rawSlots = slotSource === 'cafe' ? data?.cafeCarouselSlots : data?.carouselSlots
        setCarouselSlots(Array.isArray(rawSlots) ? rawSlots : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slotSource, refreshSignal])

  // zone then preferVideo, both independent, optional, and combinable -
  // raw carouselSlots stays the true fetched state throughout; these are
  // purely display-order/selection derivations, never a second data source.
  const zoneFilteredSlots = zone ? carouselSlots.filter((slot) => slot.zone === zone || slot.zone === 'both') : carouselSlots
  const videoSlots = zoneFilteredSlots.filter((slot) => slot.mediaType === 'mp4')
  const effectiveSlots = preferVideo && videoSlots.length > 0 ? videoSlots : zoneFilteredSlots

  // Cycles through enabled carousel slots in order, each for its own
  // duration (mp4DurationSeconds overrides durationSeconds for mp4),
  // looping back to the first after the last - plain cut, no fade/swipe
  // transition (explicitly out of phase-1 scope).
  useEffect(() => {
    window.clearTimeout(timerRef.current)
    if (effectiveSlots.length === 0) return

    setActiveIndex(0)
    let index = 0

    const scheduleNext = () => {
      const slot = effectiveSlots[index]
      const seconds =
        slot.mediaType === 'mp4' && slot.mp4DurationSeconds ? slot.mp4DurationSeconds : slot.durationSeconds
      timerRef.current = window.setTimeout(() => {
        index = (index + 1) % effectiveSlots.length
        setActiveIndex(index)
        scheduleNext()
      }, Math.max(1, seconds) * 1000)
    }
    scheduleNext()

    return () => window.clearTimeout(timerRef.current)
  }, [effectiveSlots])

  const hasCarousel = effectiveSlots.length > 0
  const activeSlot = hasCarousel ? effectiveSlots[activeIndex] : null

  // Actual media content (image/mp4/webcam/pdf) fills the panel
  // edge-to-edge. Only the empty-state placeholder text keeps its
  // padding, since it's centred text, not a media element.
  const isEdgeToEdgeContent = hasCarousel ? !!activeSlot : !!webcamUrl || item.type === 'image'

  return (
    <div
      className={`h-full overflow-hidden rounded-xl border border-border bg-slate-950/90 shadow-lg shadow-slate-950/30 ${
        fill ? 'w-full' : 'aspect-video max-h-full max-w-full'
      }`}
    >
      <div
        className={`relative flex h-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-slate-900/60 text-center ${isEdgeToEdgeContent ? '' : 'p-6'}`}
      >
        {hasCarousel ? (
          // Every slot stays mounted for the panel's whole lifetime - only
          // the active one is visually shown (absolute + inset-0 stacks
          // them exactly on top of one another, same box every slot
          // already renders into via its own h-full w-full, so this is a
          // pure visibility swap with no layout/size change). Previously
          // this rendered ONLY activeSlot, so a webcam slide's <iframe>
          // (or any other slot's DOM) was destroyed the moment the
          // carousel moved on and rebuilt from scratch - a full reload -
          // whenever it came back around. visibility:hidden (Tailwind's
          // `invisible`), not display:none: both keep the DOM/JS state
          // alive, but display:none is more likely to make a browser
          // throttle/suspend an embedded iframe's rendering while hidden,
          // which is exactly the "still alive" property this exists to
          // preserve. key={slot.slotNumber} - stable per-slot identity
          // (not array index; slots don't reorder at runtime, but this is
          // the correct key regardless) so React keeps reusing the same
          // component instance/DOM node across every activeIndex change,
          // never remounting a slot just because a sibling did.
          effectiveSlots.map((slot, index) => (
            <div key={slot.slotNumber} className={`absolute inset-0 ${index === activeIndex ? '' : 'invisible'}`}>
              <MediaSlotRenderer slot={slot} isActive={index === activeIndex} />
            </div>
          ))
        ) : webcamUrl ? (
          <iframe
            src={webcamUrl}
            className="h-full w-full"
            style={{ border: 0 }}
            allow="autoplay"
            allowFullScreen
            title="Aeroclub webcam"
          />
        ) : (
          renderMediaContent(item)
        )}
      </div>
    </div>
  )
}
