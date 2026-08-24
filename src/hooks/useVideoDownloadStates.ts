import { useEffect, useMemo, useReducer, useState } from 'react'
import { getVideoDownloadState, subscribeVideoDownload, type VideoDownloadState } from '../services/videoDownloadManager'

// Subscribes to a whole SET of video urls at once (not one hook call
// per url - the set size varies per tenant/carousel, and hooks can't be
// called a variable number of times) and re-renders whenever ANY of
// them changes. Registering a url here is also what enqueues it with
// the shared download manager in the first place (see that module's
// own comment on why this - and only this - determines download
// order): callers should pass urls already in the order they want them
// downloaded.
//
// Re-subscribes whenever the actual SET of urls changes (not on every
// render) - urlsKey is a stable, order-preserving fingerprint of the
// array's contents, not the array reference itself, since callers
// frequently derive `urls` fresh each render via .filter()/.map().
export function useVideoDownloadStates(urls: string[]): Record<string, VideoDownloadState> {
  const urlsKey = urls.join('\n')
  const [, forceRender] = useReducer((count: number) => count + 1, 0)

  useEffect(() => {
    const currentUrls = urlsKey ? urlsKey.split('\n') : []
    const unsubscribes = currentUrls.map((url) => subscribeVideoDownload(url, forceRender))
    // Catches up in case any of these urls' state already changed
    // between this render and this effect running (e.g. already
    // tracked from an earlier mount elsewhere and already 'ready').
    forceRender()
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey])

  // Deliberately NOT memoized - this must recompute on every render this
  // hook produces, including the ones forceRender() triggers with no
  // change to urlsKey at all (a byte-progress tick on an unchanged set
  // of urls). The loop itself is cheap (a handful of urls, a Map
  // lookup each), so recomputing on every render is not a real cost.
  const result: Record<string, VideoDownloadState> = {}
  for (const url of urls) result[url] = getVideoDownloadState(url)
  return result
}

// Aggregate readiness over a set of currently-included video urls -
// the one shared "is the gate clear" computation used by both
// MediaPanel's own box-scoped gate and the new whole-page gate, so
// there is exactly one definition of "ready" anywhere in the app, not
// two independently-maintained ones.
export function useVideoRotationGate(urls: string[]): {
  states: Record<string, VideoDownloadState>
  readyCount: number
  total: number
  allReady: boolean
} {
  const states = useVideoDownloadStates(urls)
  const readyCount = urls.filter((url) => states[url]?.status === 'ready').length
  return { states, readyCount, total: urls.length, allReady: urls.length === 0 || readyCount === urls.length }
}

// The shared "is the buffering gate clear yet" computation - the ONE
// definition of gate-readiness used both by MediaPanel.tsx's own
// existing box-scoped overlay and by the new whole-page FullBufferGate,
// so there is never a second, independently-maintained notion of
// "ready" anywhere in the app (requirement's own explicit ask).
//
// A slot counts as "resolved" (able to let the gate clear) once its
// download is either ready OR stalled - stalled is a terminal outcome
// for THIS pass through the gate (see videoDownloadManager's own
// comment on why a stall/error is never a permanent dead end, just a
// reason to stop waiting and let it retry in the background instead).
//
// Latched, not continuously recomputed: once every url has resolved and
// the gate clears, gateCleared stays true for the rest of this mount
// even if a slot stalls again later, or a previously-stalled slot is
// still mid-retry - a stall/rejoin after the gate has already cleared
// must never re-block it (requirement: gate re-triggers on mount/reload
// only). `enabled` false skips the mechanism entirely and reports
// already-cleared, with nothing registered/downloaded via this call -
// the caller's own normal per-slot loading (if any) is unaffected.
export function useBufferingGate(
  urls: string[],
  enabled: boolean
): {
  downloadStates: Record<string, VideoDownloadState>
  resolvedCount: number
  total: number
  gateCleared: boolean
  stalledUrls: Set<string>
} {
  const trackedUrls = enabled ? urls : []
  const downloadStates = useVideoDownloadStates(trackedUrls)
  const total = trackedUrls.length

  const resolvedCount = trackedUrls.filter((url) => {
    const status = downloadStates[url]?.status
    return status === 'ready' || status === 'stalled'
  }).length

  // Sorted+joined string fingerprint, not the raw downloadStates object -
  // so the Set below (and anything a caller memoizes off it) only gets a
  // new identity when the actual SET of stalled urls changes, not on
  // every single byte-progress tick of an unrelated in-flight download.
  const stalledUrlsKey = trackedUrls
    .filter((url) => downloadStates[url]?.status === 'stalled')
    .sort()
    .join('\n')
  const stalledUrls = useMemo(() => new Set(stalledUrlsKey ? stalledUrlsKey.split('\n') : []), [stalledUrlsKey])

  const [gateCleared, setGateCleared] = useState(!enabled)
  useEffect(() => {
    if (!enabled || gateCleared) return
    if (total === 0 || resolvedCount === total) setGateCleared(true)
  }, [enabled, gateCleared, resolvedCount, total])

  return { downloadStates, resolvedCount, total, gateCleared, stalledUrls }
}
