// Byte-verified video readiness (buffering-gate redesign round) - the
// single source of truth for whether a video URL's ENTIRE file has
// actually finished downloading. Used everywhere a video slot's
// readiness matters: MediaSlotRenderer's own <video> src (never points
// at the network URL directly - only ever a Blob object URL, once
// confirmed complete), MediaPanel's own box-scoped buffering gate and
// stalled-slot exclusion, DashboardPage.tsx/TenantDisplayPage.tsx's new
// whole-page gate, and Media Manager/Cafe Media's own red/white slot
// indicators - one tracked download per URL, one definition of "ready",
// never duplicated per consumer.
//
// Replaces relying on the <video> element's own canplaythrough event
// plus a fixed force-advance timeout. Confirmed by direct investigation
// (real network instrumentation against a real 18.4MB production file,
// both throttled and at full speed) that this was the actual root
// cause of videos starting playback before they'd genuinely finished
// downloading: canplaythrough is a browser heuristic estimate ("at the
// CURRENT download rate, probably won't need to stall"), not a "fully
// downloaded" signal, and a paused <video> element does not eagerly
// download its file even on a fast connection - Chrome paces its own
// fetching conservatively regardless of available bandwidth. Both the
// heuristic event and the safety timeout could fire (and did, in
// testing) with only a small fraction of a large file actually
// buffered, which is exactly the "plays for a moment then stalls"
// symptom this replaces.
//
// Strictly sequential: only ONE url downloads at a time, module-wide,
// regardless of how many components ask about how many different
// urls - everything else queues. This is deliberate, not a limitation:
// the original bandwidth-contention bug (every mounted video slot
// trying to download simultaneously) this whole feature exists to fix
// was caused by exactly that. Ordering follows first-registered order,
// which callers control simply by calling useVideoDownloadStates with
// urls in the order they want them downloaded (MediaPanel registers
// slots in rotation order).

export type VideoDownloadStatus = 'queued' | 'downloading' | 'ready' | 'stalled'

export interface VideoDownloadState {
  status: VideoDownloadStatus
  bytesReceived: number
  totalBytes: number | null
  // 0-1. Best-effort - 0 whenever totalBytes is unknown (no
  // Content-Length header) and not yet ready; R2 always sends
  // Content-Length on a normal GET in practice, so this is a
  // defensive fallback, not the expected case.
  progress: number
  // Only ever set once status === 'ready' - MediaSlotRenderer's own
  // <video src> is gated on this being non-null, never on the network
  // url directly, so playback can only ever come from bytes already
  // fully verified in memory.
  objectUrl: string | null
}

const IDLE_STATE: VideoDownloadState = { status: 'queued', bytesReceived: 0, totalBytes: null, progress: 0, objectUrl: null }

// Requirement's own exact figure - 2 continuous minutes with zero new
// bytes marks a slot stalled/excluded.
const STALL_THRESHOLD_MS = 2 * 60 * 1000
// How often the watchdog checks the currently-active download for a
// stall - only needs to catch a 2-minute stall within a few seconds of
// it happening, not be tight/real-time.
const STALL_CHECK_INTERVAL_MS = 5_000

// Minimum delay before a GENUINE-FAILURE url (startDownload's own catch
// block - a fetch() that rejects/throws outright, e.g. CORS, a 404, a
// short read) is allowed to rejoin the queue and retry itself. Confirmed
// by direct reproduction (a standalone probe running this exact retry
// shape against an always-rejecting fetch) that without this, a hard
// failure that rejects near-instantly creates an unbounded, zero-delay
// retry loop - each attempt fails and requeues itself in well under a
// millisecond, chaining through pure promise microtasks with no real
// I/O to force a yield, which starves the event loop entirely (observed:
// 100%+ CPU, multiple GB of memory growth, not even a 3-second
// setTimeout ever got a turn). The existing watchdog-driven slow-stall
// path (stallActiveDownload below) never needed this: a retry there
// can't fail again in under ~2 minutes, since it has to hang that long
// again before the SAME watchdog re-fires, so it's already naturally
// throttled and is deliberately left untouched.
const RETRY_BACKOFF_MS = 5_000

interface TrackedDownload {
  state: VideoDownloadState
  lastByteAt: number
  chunks: Uint8Array[]
  controller: AbortController | null
  listeners: Set<() => void>
}

const downloads = new Map<string, TrackedDownload>()
// FIFO of urls waiting their turn - a stalled url rejoins the BACK of
// this exact same queue on retry (requirement: never a parallel retry,
// never jumps ahead of whatever's already waiting).
const queue: string[] = []
let activeUrl: string | null = null
let watchdogTimer: ReturnType<typeof setInterval> | null = null

function notify(url: string): void {
  const d = downloads.get(url)
  if (!d) return
  for (const listener of d.listeners) listener()
}

function ensureWatchdog(): void {
  if (watchdogTimer) return
  watchdogTimer = setInterval(() => {
    if (!activeUrl) return
    const d = downloads.get(activeUrl)
    if (!d) return
    if (Date.now() - d.lastByteAt > STALL_THRESHOLD_MS) stallActiveDownload()
  }, STALL_CHECK_INTERVAL_MS)
}

// Marks the currently-active download stalled and requeues it - shared
// by the watchdog (zero bytes for 2+ minutes) and startDownload's own
// catch block (a genuine fetch/stream error, e.g. a 404 or a short
// read) - both outcomes mean the same thing to every consumer: this
// slot isn't currently working, exclude it from rotation, keep quietly
// retrying in the background via the same sequential queue, and it can
// rejoin the moment a retry actually succeeds. No separate "error"
// status - a broken url and a stalled one are indistinguishable from a
// viewer's perspective (neither ever shows), and both deserve the exact
// same graceful-retry treatment rather than a permanent dead end.
function stallActiveDownload(): void {
  const url = activeUrl
  if (!url) return
  const d = downloads.get(url)
  if (!d) return
  d.controller?.abort()
  d.controller = null
  d.chunks = []
  d.state = { status: 'stalled', bytesReceived: 0, totalBytes: d.state.totalBytes, progress: 0, objectUrl: null }
  activeUrl = null
  notify(url)
  queue.push(url)
  processQueue()
}

function processQueue(): void {
  if (activeUrl) return
  const next = queue.shift()
  if (!next) return
  activeUrl = next
  void startDownload(next)
}

async function startDownload(url: string): Promise<void> {
  const d = downloads.get(url)
  if (!d) return
  const controller = new AbortController()
  d.controller = controller
  d.chunks = []
  d.lastByteAt = Date.now()
  d.state = { status: 'downloading', bytesReceived: 0, totalBytes: d.state.totalBytes, progress: 0, objectUrl: null }
  notify(url)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`video fetch failed: ${response.status}`)
    const contentLengthHeader = response.headers.get('content-length')
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : null
    d.state = { ...d.state, totalBytes }

    const reader = response.body.getReader()
    let bytesReceived = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        d.chunks.push(value)
        bytesReceived += value.byteLength
        d.lastByteAt = Date.now()
        const progress = totalBytes ? Math.min(1, bytesReceived / totalBytes) : 0
        d.state = { status: 'downloading', bytesReceived, totalBytes, progress, objectUrl: null }
        notify(url)
      }
    }

    // A stream that ends early/short (fewer bytes than Content-Length
    // promised) is NOT genuinely complete - falls into the catch block
    // below via the thrown error, same graceful stall/retry path as any
    // other failure. Unknown totalBytes (no Content-Length at all - not
    // expected from R2, handled defensively) treats a clean stream end
    // as completion, since there's no byte count to verify against.
    if (totalBytes !== null && bytesReceived < totalBytes) {
      throw new Error(`video stream ended short: ${bytesReceived}/${totalBytes}`)
    }

    const blob = new Blob(d.chunks as BlobPart[])
    const objectUrl = URL.createObjectURL(blob)
    d.chunks = []
    d.controller = null
    d.state = { status: 'ready', bytesReceived, totalBytes: totalBytes ?? bytesReceived, progress: 1, objectUrl }
    notify(url)
  } catch (err) {
    if (controller.signal.aborted) {
      // Already handled by stallActiveDownload (which already set
      // status/requeued before calling abort()) - nothing further to
      // do here, this branch just absorbs the resulting AbortError.
      return
    }
    d.chunks = []
    d.controller = null
    d.state = { status: 'stalled', bytesReceived: 0, totalBytes: d.state.totalBytes, progress: 0, objectUrl: null }
    notify(url)
    // Delayed re-enqueue (RETRY_BACKOFF_MS, see that constant's own
    // comment) - NOT queue.push(url) here directly. This url's own
    // retry is what needed throttling, not queue advancement in
    // general, so this stays entirely separate from the finally
    // block's own immediate processQueue() call below, which still
    // advances to whichever OTHER url is next in queue (if any)
    // without waiting on this url's backoff at all.
    setTimeout(() => {
      queue.push(url)
      processQueue()
    }, RETRY_BACKOFF_MS)
  } finally {
    if (activeUrl === url) {
      activeUrl = null
      processQueue()
    }
  }
}

function ensureTracked(url: string): void {
  if (downloads.has(url)) return
  downloads.set(url, { state: { ...IDLE_STATE }, lastByteAt: Date.now(), chunks: [], controller: null, listeners: new Set() })
  queue.push(url)
  ensureWatchdog()
  processQueue()
}

export function getVideoDownloadState(url: string): VideoDownloadState {
  return downloads.get(url)?.state ?? IDLE_STATE
}

export function subscribeVideoDownload(url: string, callback: () => void): () => void {
  ensureTracked(url)
  const d = downloads.get(url)
  if (!d) return () => {}
  d.listeners.add(callback)
  return () => {
    d.listeners.delete(callback)
  }
}
