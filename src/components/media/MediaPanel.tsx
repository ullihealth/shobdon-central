import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MediaItem } from '../../types/media'
import { PUBLIC_CONFIG_URL } from '../../config/publicApi'
import MediaSlotRenderer, { type MediaSlotVisual } from './MediaSlotRenderer'
import { useBufferingGate, isTrackedMediaType, type GateAsset } from '../../hooks/useVideoDownloadStates'

interface CarouselSlotResolved extends MediaSlotVisual {
  slotNumber: number
  durationSeconds: number
  mp4DurationSeconds: number | null
  zone: 'both' | 'left' | 'right'
  autoFullscreen: boolean
  // Byte-weighted buffering gate round - real media_library.sizeBytes
  // for this slot's file (null for mp4-in-progress-before-headers,
  // webcam/gyropedia/reserved/website) - see GateAsset's own comment
  // for how this feeds the aggregate percentage.
  mediaSizeBytes: number | null
}

// Exported (not just the local MediaPanelProps['data'] shape) so the
// template components that thread this through to MediaPanel
// (CentreDisplayPanel, Clubhouse1Template, Clubhouse2Template) can type
// their own pass-through props against it directly, instead of each
// re-declaring the same shape or reaching for an awkward indexed-access
// type off MediaPanelProps itself.
export interface MediaPanelSourceData {
  cameraSlots?: { slot: number; url: string }[]
  carouselSlots?: CarouselSlotResolved[]
  cafeCarouselSlots?: CarouselSlotResolved[]
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
  // Ignored entirely when `data` (below) is provided - a parent passing
  // its own fetched data is already responsible for refetching and
  // handing this component a new object when it changes.
  refreshSignal?: number
  // When provided, MediaPanel uses this instead of self-fetching
  // PUBLIC_CONFIG_URL - added this round after tracing a real cross-
  // tenant leak: PUBLIC_CONFIG_URL resolves its tenant from the
  // request's Host header, which is correct for the actual public kiosk
  // dashboard (no session exists there at all) but wrong for an
  // authenticated admin preview (DesignPage.tsx, CafeMediaPage.tsx) -
  // an admin who switches their session to a DIFFERENT org via the
  // org-switcher, while staying on their default tenant's own
  // subdomain, would silently see THAT subdomain's real carousel/
  // webcam data instead of the org their session actually switched to.
  // Every existing caller (the real public dashboard templates -
  // Clubhouse1/2Template, CafeTemplate, ClassicTemplate as rendered on
  // "/" and "/d/:slug") omits this and keeps today's self-fetch-by-Host
  // behaviour completely unchanged.
  data?: MediaPanelSourceData
  // Staged-preload/buffering-gate round - explicit now rather than
  // inferring "is this a preview" from `data` being truthy (what the
  // autoFullscreen portal below used to do). That inference had a real
  // gap: DesignPage.tsx/CafeMediaPage.tsx's own `data` starts as
  // `undefined` for a render or two before THEIR OWN fetch resolves, so
  // `!data` was briefly true even in a preview - harmless for the
  // portal (autoFullscreen slots are rare), but the buffering gate this
  // round adds is a full-screen blocking overlay, not something that
  // should ever flicker on for an admin even for one frame. Every real
  // public template caller omits this (stays false) and is unaffected;
  // DesignPage.tsx/CafeMediaPage.tsx now pass it explicitly.
  isPreview?: boolean
}

export default function MediaPanel({
  item,
  preferVideo,
  zone,
  fill,
  slotSource = 'dashboard',
  refreshSignal,
  data,
  isPreview = false,
}: MediaPanelProps): JSX.Element {
  // Club-configured live webcam takes priority over item (image/placeholder)
  // whenever it's set - empty string (no webcam configured, or not yet
  // loaded) falls back to item exactly as before. This is the pre-
  // carousel behaviour, kept completely unchanged as the fallback tier
  // below: the carousel only takes over when it actually has at least
  // one enabled slot; a not-yet-configured or fully-disabled carousel
  // falls straight through to this, not a broken empty screen.
  const [webcamUrl, setWebcamUrl] = useState('')
  const [carouselSlots, setCarouselSlots] = useState<CarouselSlotResolved[]>([])
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    // Pre-fetched, session-scoped data takes over entirely - no self-
    // fetch, no dependency on refreshSignal (the parent already owns
    // refetching and hands this a new `data` object when it changes).
    if (data) {
      const slotOne = data.cameraSlots?.find((slot) => slot.slot === 1)
      setWebcamUrl(slotOne?.url || '')
      const rawSlots = slotSource === 'cafe' ? data.cafeCarouselSlots : data.carouselSlots
      setCarouselSlots(Array.isArray(rawSlots) ? rawSlots : [])
      return
    }

    let cancelled = false
    fetch(PUBLIC_CONFIG_URL)
      .then((response) => {
        if (!response.ok) {
          // Was silently treated identically to "fetch succeeded, zero
          // slots configured" (both fell through to the same null/empty
          // result below) - genuinely indistinguishable from a tenant
          // with no carousel content at all. Logged now so a real
          // failure (rate limit, transient 5xx, timeout) is at least
          // visible in the console instead of masquerading as "nothing
          // to show" with zero trace of what actually happened.
          console.error(`MediaPanel: public config fetch failed (${response.status})`)
          return null
        }
        return response.json()
      })
      .then((responseData) => {
        if (cancelled) return
        const slotOne = responseData?.cameraSlots?.find((slot: { slot: number; url: string }) => slot.slot === 1)
        if (slotOne?.url) setWebcamUrl(slotOne.url)
        const rawSlots = slotSource === 'cafe' ? responseData?.cafeCarouselSlots : responseData?.carouselSlots
        setCarouselSlots(Array.isArray(rawSlots) ? rawSlots : [])
      })
      .catch((err) => {
        if (!cancelled) console.error('MediaPanel: public config fetch threw', err)
      })
    return () => {
      cancelled = true
    }
  }, [data, slotSource, refreshSignal])

  // zone then preferVideo, both independent, optional, and combinable -
  // raw carouselSlots stays the true fetched state throughout; these are
  // purely display-order/selection derivations, never a second data source.
  //
  // Memoized (was three plain .filter() calls run fresh on every render)
  // - .filter() always returns a NEW array, even when the result is
  // element-for-element identical to last time, so effectiveSlots had a
  // different reference on EVERY render of this component, not just
  // when carouselSlots/zone/preferVideo actually changed. The cycling
  // effect below is keyed on [effectiveSlots], so it was re-running on
  // every single re-render this component received for ANY reason
  // (e.g. a parent re-rendering from unrelated weather-polling context
  // updates) - clearing the running timer and forcing activeIndex back
  // to 0 each time, which would visibly snap a multi-slot carousel back
  // to its first slide mid-rotation, discarding whatever was actually
  // showing. Memoizing so the reference only changes when the real
  // inputs do fixes this at the source, rather than working around it
  // in the effect below.
  const zoneFilteredSlots = useMemo(
    () => (zone ? carouselSlots.filter((slot) => slot.zone === zone || slot.zone === 'both') : carouselSlots),
    [carouselSlots, zone]
  )
  const videoSlots = useMemo(() => zoneFilteredSlots.filter((slot) => slot.mediaType === 'mp4'), [zoneFilteredSlots])
  const effectiveSlots = useMemo(
    () => (preferVideo && videoSlots.length > 0 ? videoSlots : zoneFilteredSlots),
    [preferVideo, videoSlots, zoneFilteredSlots]
  )

  // Buffering-gate round - every slot THIS panel's own rotation will
  // show (post zone/preferVideo filtering), in rotation order, as
  // GateAssets - trackable slots (mp4, and now image - see
  // isTrackedMediaType's own comment) carry their resolvedUrl
  // (registering it via useVideoDownloadStates is also what enqueues
  // it with the shared, module-wide download manager, see that hook's
  // own comment - the manager's own strict one-at-a-time queue is what
  // now enforces sequential loading, replacing the old shouldSlotLoad
  // cursor this file used to maintain by hand); every other slot
  // carries only its real sizeBytes (or null), feeding the byte-
  // weighted percentage below without being tracked/downloaded at all.
  // gateCleared/resolvedCount/total below stay driven purely by the
  // trackable urls among these (useBufferingGate's own url-only
  // tracking), unaffected by including non-trackable assets here.
  const gateAssets: GateAsset[] = useMemo(
    () =>
      effectiveSlots.map((slot) => ({
        url: isTrackedMediaType(slot.mediaType) ? slot.resolvedUrl : null,
        sizeBytes: slot.mediaSizeBytes,
      })),
    [effectiveSlots]
  )
  // Preview pages get none of this (see isPreview's own comment on the
  // prop) - "fast, no buffering wait" is the explicit ask for admin
  // pages, and a preview re-checking its own already-loaded slots on
  // every edit would actively work against "quick feedback while
  // configuring".
  const { resolvedCount, total, gateCleared, stalledUrls, byteProgress } = useBufferingGate(gateAssets, !isPreview)

  const currentlyGating = !isPreview && !gateCleared && total > 0
  const bufferingDone = !currentlyGating

  // Stalled slots (requirement: excluded from rotation entirely, as if
  // manually unticked, until their background retry - via the same
  // shared queue - completes) - every non-trackable slot is unaffected,
  // and a trackable slot (mp4 or image) rejoins the moment its retry
  // succeeds and stalledUrls no longer contains its url.
  const rotationSlots = useMemo(
    () => effectiveSlots.filter((slot) => !isTrackedMediaType(slot.mediaType) || !slot.resolvedUrl || !stalledUrls.has(slot.resolvedUrl)),
    [effectiveSlots, stalledUrls]
  )

  // Tracks the current slide by slotNumber, not array index - rotationSlots
  // can change shape (a stalled slot leaving/rejoining) independently of
  // effectiveSlots, which stays the stable, always-mounted render list
  // below (see that map's own comment on why every slot - including a
  // currently-excluded one - stays mounted rather than being torn down).
  const [activeSlotNumber, setActiveSlotNumber] = useState<number | null>(null)
  // Video-loop-flash round - the slot ABOUT to become active next, so
  // MediaSlotRenderer can pre-seek that slot's video back to frame 0
  // WHILE IT'S STILL HIDDEN, well ahead of its own activation (as soon
  // as the current slot starts, not reactively once the switch already
  // happened). Real TVs confirmed to have slow-enough seek/decode
  // latency that resetting currentTime at the same moment a slot
  // becomes visible can briefly paint the video's last-known frame
  // (near the clip's own end, since the away-timer fires close to
  // natural completion) before the seek actually resolves - a multi-
  // second head start while nobody's looking makes that latency
  // irrelevant instead of trying to detect/wait it out after the fact,
  // which would just move the same visible pause earlier (the outgoing
  // slide lingering) rather than removing it.
  const [upcomingSlotNumber, setUpcomingSlotNumber] = useState<number | null>(null)

  // Cycles through the currently-included (non-excluded) slots in
  // order, each for its own duration (mp4DurationSeconds overrides
  // durationSeconds for mp4), looping back to the first after the last -
  // plain cut, no fade/swipe transition (explicitly out of phase-1
  // scope).
  //
  // Gated on bufferingDone (buffering-gate round) - the carousel must
  // not start advancing/playing at all until every currently-included
  // video has either fully downloaded or been excluded as stalled, so a
  // viewer never sees a slide start then stall mid-playback. Preview
  // pages have bufferingDone true from the very first render (see
  // isPreview above) and are completely unaffected. Re-runs (restarting
  // from the first currently-included slot) whenever rotationSlots
  // itself changes - a stalled slot leaving or rejoining rotation - the
  // same "just resets to the top" behaviour this cycling effect already
  // had for any other slot-list change.
  useEffect(() => {
    window.clearTimeout(timerRef.current)
    if (!bufferingDone || rotationSlots.length === 0) {
      setActiveSlotNumber(null)
      setUpcomingSlotNumber(null)
      return
    }

    // Single-slot rotation has no distinct "next" (it would just be
    // itself) - upcoming stays null rather than pre-seeking the
    // slot that's already active/playing.
    const nextSlotNumber = (index: number) => (rotationSlots.length > 1 ? rotationSlots[(index + 1) % rotationSlots.length].slotNumber : null)

    let index = 0
    setActiveSlotNumber(rotationSlots[0].slotNumber)
    setUpcomingSlotNumber(nextSlotNumber(0))

    const scheduleNext = () => {
      const slot = rotationSlots[index]
      const seconds =
        slot.mediaType === 'mp4' && slot.mp4DurationSeconds ? slot.mp4DurationSeconds : slot.durationSeconds
      timerRef.current = window.setTimeout(() => {
        index = (index + 1) % rotationSlots.length
        setActiveSlotNumber(rotationSlots[index].slotNumber)
        setUpcomingSlotNumber(nextSlotNumber(index))
        scheduleNext()
      }, Math.max(1, seconds) * 1000)
    }
    scheduleNext()

    return () => window.clearTimeout(timerRef.current)
  }, [rotationSlots, bufferingDone])

  const hasCarousel = effectiveSlots.length > 0
  const activeSlot = activeSlotNumber != null ? effectiveSlots.find((slot) => slot.slotNumber === activeSlotNumber) ?? null : null

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
          //
          // Single-live-instance round - a real (!isPreview) autoFullscreen
          // slot is deliberately EXCLUDED from this stack now and rendered
          // exclusively by the always-mounted portal further down instead
          // (see that block's own comment) - not duplicated here too. Only
          // an admin preview still renders an autoFullscreen slot in this
          // stack (the portal skips previews entirely, same as before this
          // round; a preview never wants true viewport-fullscreen anyway -
          // see the portal's own isPreview comment), so preview behaviour
          // for such a slot is completely unchanged: shown here, plain,
          // never fullscreen.
          effectiveSlots
            .filter((slot) => !slot.autoFullscreen || isPreview)
            .map((slot) => {
              // Nothing is genuinely active while still gating - the
              // buffering overlay (below) covers the box in that case, so
              // every slot renders invisible underneath it regardless of
              // activeSlotNumber's default (null) value. Every slot's own
              // MediaSlotRenderer registers/downloads its mp4 unconditionally
              // now (see that component's own videoDownloadUrl comment) -
              // there's no more "only load if active/next" eligibility check
              // here, since the shared download manager's own queue is what
              // enforces one-at-a-time loading instead.
              const isActive = bufferingDone && slot.slotNumber === activeSlotNumber
              const isUpNext = bufferingDone && slot.slotNumber === upcomingSlotNumber
              return (
                <div key={slot.slotNumber} className={`absolute inset-0 ${isActive ? '' : 'invisible'}`}>
                  <MediaSlotRenderer slot={slot} isActive={isActive} isUpNext={isUpNext} />
                </div>
              )
            })
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
        {/* Buffering gate overlay (real public screens only - see
            currentlyGating's own comment) - covers the box completely
            while every slide underneath sits invisible, so a viewer
            never sees a stalling half-loaded video, only this, until
            everything currently enabled has either loaded or been
            given up on. z-30, below the autoFullscreen portal's z-50
            (nothing is fullscreen-active during the gate anyway, since
            isActive is forced false for every slot, but keeping the
            stacking order correct regardless). */}
        {currentlyGating && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-slate-950 text-center">
            <div className="text-xl font-bold uppercase tracking-widest text-primary">Buffering Media</div>
            {/* Byte-weighted percentage (primary) - same computation
                FullBufferGate.tsx's whole-page gate uses, continuous
                and driven by actual bytes received rather than
                file-completion count, so a single large video doesn't
                leave this looking frozen for a long stretch while
                it's genuinely downloading fine. */}
            <div className="text-3xl font-black tabular-nums text-primary">{Math.round(byteProgress * 100)}%</div>
            <div className="text-sm font-semibold text-muted-300">
              {resolvedCount} of {total} assets ready
            </div>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-accent-sky-500 transition-all duration-300"
                style={{ width: `${byteProgress * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {/* Auto-fullscreen (admin-configured per slot, see migration
          0063's own comment) - a viewport-covering portal, not a
          bigger version of the normal box, so it genuinely takes over
          the whole screen the way a video/camera slide's "fullscreen"
          is meant to read. Portaled to document.body rather than
          rendered in place, since this component can sit arbitrarily
          deep inside a template's own layout (Clubhouse1Template's
          centre column, Café's zone panes, and Screens Design's own
          live preview - confirmed that one actually DOES apply a CSS
          transform to scale the whole template down, see
          Clubhouse1Template.tsx's own isPreview comment) -
          position:fixed alone isn't reliable from inside an ancestor
          that happens to set its own transform/filter, which would
          silently confine it to that ancestor's box instead of the
          real viewport.

          Remount round: this used to be conditionally CREATED
          (`activeSlot?.autoFullscreen && createPortal(...)`), mounting
          a brand-new second <MediaSlotRenderer> instance for
          activeSlot every time it became the active slide, and
          destroying it the instant the carousel moved on. That's a
          real DOM/iframe reload each cycle, not just a visibility
          change - the exact "still alive" property the plain
          absolute-stack above was built to guarantee for the SAME
          reason didn't apply to this second, portaled copy at all.
          Confirmed via a live YouTube-embedded webcam slide: autoplay
          silently died and required a manual click to resume every
          time the carousel rotated back to it, specifically (and only)
          when auto-expand was enabled - the zoom/crop appearance
          setting was not the cause (it's a CSS transform on the
          already-mounted iframe, see zoomPanTransformStyle - never
          triggers a remount on its own).

          Fixed the same way the main stack already solved this: the
          portal itself is now always present (unconditional), and
          every slot that has autoFullscreen set gets exactly ONE
          always-mounted instance inside it, toggled visible only while
          it's the active slide via the identical `invisible`-class
          technique used above - never conditionally created/destroyed.
          Slots without autoFullscreen get no portaled copy at all (no
          change for them).

          Single-live-instance round: the paragraph above originally
          ended here with "a slot's fullscreen copy and its own always-
          mounted copy in the main stack ARE both live simultaneously
          while active" - true at the time, and harmless for ordinary
          media (image/mp4/website/pdf), but for a `webcam` slot
          (a live YouTube/relay iframe) it meant TWO independent,
          permanently-alive embeds of the SAME live stream mounted at
          once. Confirmed live: YouTube's own live-broadcast infra
          doesn't reliably tolerate two concurrent embedded sessions of
          the same video id from one page - Gyroplane Train's webcam
          slide (the first, and so far only, webcam slot ever configured
          with autoFullscreen) would flash the live feed once on load,
          then flip to YouTube's own "Video unavailable" state - the
          stream itself was never unhealthy (confirmed via YouTube
          Studio, a plain watch-page load, and "allow embedding"), it
          was our own duplicate embed getting one of the two sessions
          rejected. Fixed by making the two copies mutually exclusive
          instead of simultaneous: the main stack above now explicitly
          EXCLUDES any real (non-preview) autoFullscreen slot from its
          own render (see that map's own `.filter`), so this portal is
          now the single, sole place such a slot's MediaSlotRenderer -
          and therefore its one live iframe - ever exists. Nothing about
          THIS portal's own always-mounted/never-destroyed structure
          needed to change to fix this; only the main stack's competing
          copy needed to go.

          Gated on `!isPreview`: never true for an admin preview
          (DesignPage.tsx, CafeMediaPage.tsx - see that prop's own
          comment), always false for the real public kiosk templates.
          Confirmed live: a café slot with autoFullscreen on (the newer
          Website content type, but this applies to any mediaType) took
          over Jeff's entire browser tab while editing CafeMediaPage.tsx,
          not just its small preview box - document.body is the real
          page in an admin preview, so the portal had nowhere smaller to
          escape to. Skipping it entirely in a preview fixes every admin
          preview call site at once (both hand-mirrored café previews
          AND any other template rendered in preview mode that happens
          to reach this same MediaPanel), with zero effect on the real
          screen. isActive also respects bufferingDone (buffering-gate
          round) for the identical reason the main stack above does -
          nothing is genuinely active, fullscreen or otherwise, until
          every currently-included video has resolved. */}
      {!isPreview &&
        createPortal(
          <>
            {effectiveSlots
              .filter((slot) => slot.autoFullscreen)
              .map((slot) => {
                const isActive = bufferingDone && activeSlot?.slotNumber === slot.slotNumber
                const isUpNext = bufferingDone && slot.slotNumber === upcomingSlotNumber
                return (
                  <div key={slot.slotNumber} className={`fixed inset-0 z-50 bg-black ${isActive ? '' : 'invisible'}`}>
                    <MediaSlotRenderer slot={slot} isActive={isActive} isUpNext={isUpNext} />
                  </div>
                )
              })}
          </>,
          document.body
        )}
    </div>
  )
}
