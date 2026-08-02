import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { MEDIA_LIBRARY_UPLOAD_URL } from '../config/publicApi'

// Owns the actual upload (XHR, not fetch - see StartUploadParams below
// for why) independently of MediaLibraryPage's own lifecycle, mounted
// once in App.tsx the same way RemoteRefreshWatcher.tsx holds its own
// persistent state above the router - a client-side route change
// (React Router's <Link>, not a real page reload) unmounts the PAGE
// that started the upload, but never this provider, so the upload
// itself, its progress, and its eventual outcome all keep being tracked
// with nowhere to silently vanish to. Scoped to SPA navigation only, by
// design - a real full-page reload or tab close still ends it, same as
// any in-memory React state; surviving that would need persisting to
// IndexedDB/localStorage and re-attaching, a separate, larger piece of
// work not part of this round.
export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

interface UploadState {
  status: UploadStatus
  filename: string | null
  percent: number
  errorMessage: string | null
}

export interface StartUploadParams {
  file: File
  mediaType: string
  usableOn: string
  orientation?: string | null
  mp4DurationSeconds?: number | null
  folderId?: string | null
}

interface UploadContextValue extends UploadState {
  startUpload: (params: StartUploadParams) => void
  // Clears status back to 'idle' - called by UploadIndicator.tsx after
  // its own short auto-dismiss delay on success/error, and by
  // MediaLibraryPage once it's reacted to a completed upload (see that
  // file's own comment). Not called on 'uploading' - only ever clears a
  // finished (or never-started) state.
  dismiss: () => void
}

const UploadContext = createContext<UploadContextValue | undefined>(undefined)

const IDLE_STATE: UploadState = { status: 'idle', filename: null, percent: 0, errorMessage: null }

export function UploadProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<UploadState>(IDLE_STATE)

  // XMLHttpRequest, not fetch - fetch has no upload-progress event at
  // all (its streaming support only covers reading the RESPONSE body,
  // not observing how much of the REQUEST body has been sent yet);
  // xhr.upload.onprogress is the standard, broadly-supported way to get
  // real byte-level progress. Same raw-binary-body request shape as the
  // fetch() call this replaces (xhr.send(file), not FormData) - the
  // backend (functions/api/tenant/media-library/upload.ts) streams the
  // request body straight to R2 and was never touched here, only the
  // client-side transport changed.
  function startUpload({ file, mediaType, usableOn, orientation, mp4DurationSeconds, folderId }: StartUploadParams) {
    const params = new URLSearchParams({ filename: file.name, mediaType, usableOn })
    if (mp4DurationSeconds != null) params.set('mp4DurationSeconds', String(mp4DurationSeconds))
    if (orientation) params.set('orientation', orientation)
    if (folderId) params.set('folderId', folderId)

    setState({ status: 'uploading', filename: file.name, percent: 0, errorMessage: null })

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${MEDIA_LIBRARY_UPLOAD_URL}?${params.toString()}`)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      setState((prev) => (prev.status === 'uploading' ? { ...prev, percent: Math.round((event.loaded / event.total) * 100) } : prev))
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setState({ status: 'success', filename: file.name, percent: 100, errorMessage: null })
        return
      }
      // Same error-shape assumption the old fetch()-based handler made
      // (a JSON { error } body from upload.ts's own jsonResponse) - falls
      // back to a generic message if the response isn't parseable JSON
      // for any reason, rather than throwing.
      let message = 'Upload failed'
      try {
        const data = JSON.parse(xhr.responseText) as { error?: string }
        if (data?.error) message = data.error
      } catch {
        // Keep the generic message - not this handler's job to surface
        // a raw non-JSON response body.
      }
      setState({ status: 'error', filename: file.name, percent: 0, errorMessage: message })
    }

    xhr.onerror = () => {
      setState({ status: 'error', filename: file.name, percent: 0, errorMessage: 'Upload failed - check your connection and try again' })
    }

    xhr.send(file)
  }

  function dismiss() {
    setState(IDLE_STATE)
  }

  return <UploadContext.Provider value={{ ...state, startUpload, dismiss }}>{children}</UploadContext.Provider>
}

export function useUpload(): UploadContextValue {
  const context = useContext(UploadContext)
  if (!context) {
    throw new Error('useUpload must be used within an UploadProvider')
  }
  return context
}
