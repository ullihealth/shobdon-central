import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../../types/media'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import MediaSlotRenderer, { type MediaSlotVisual } from './MediaSlotRenderer'

interface CarouselSlotResolved extends MediaSlotVisual {
  slotNumber: number
  durationSeconds: number
  mp4DurationSeconds: number | null
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
}

export default function MediaPanel({ item }: MediaPanelProps): JSX.Element {
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
        setCarouselSlots(Array.isArray(data?.carouselSlots) ? data.carouselSlots : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Cycles through enabled carousel slots in order, each for its own
  // duration (mp4DurationSeconds overrides durationSeconds for mp4),
  // looping back to the first after the last - plain cut, no fade/swipe
  // transition (explicitly out of phase-1 scope).
  useEffect(() => {
    window.clearTimeout(timerRef.current)
    if (carouselSlots.length === 0) return

    setActiveIndex(0)
    let index = 0

    const scheduleNext = () => {
      const slot = carouselSlots[index]
      const seconds =
        slot.mediaType === 'mp4' && slot.mp4DurationSeconds ? slot.mp4DurationSeconds : slot.durationSeconds
      timerRef.current = window.setTimeout(() => {
        index = (index + 1) % carouselSlots.length
        setActiveIndex(index)
        scheduleNext()
      }, Math.max(1, seconds) * 1000)
    }
    scheduleNext()

    return () => window.clearTimeout(timerRef.current)
  }, [carouselSlots])

  const hasCarousel = carouselSlots.length > 0
  const activeSlot = hasCarousel ? carouselSlots[activeIndex] : null

  // Actual media content (image/mp4/webcam/pdf) fills the panel
  // edge-to-edge. Only the empty-state placeholder text keeps its
  // padding, since it's centred text, not a media element.
  const isEdgeToEdgeContent = hasCarousel ? !!activeSlot : !!webcamUrl || item.type === 'image'

  return (
    <div
      className="aspect-video h-full max-h-full max-w-full overflow-hidden rounded-xl border border-border bg-slate-950/90 shadow-lg shadow-slate-950/30"
    >
      <div
        className={`flex h-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-slate-900/60 text-center ${isEdgeToEdgeContent ? '' : 'p-6'}`}
      >
        {hasCarousel ? (
          activeSlot && <MediaSlotRenderer slot={activeSlot} />
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
