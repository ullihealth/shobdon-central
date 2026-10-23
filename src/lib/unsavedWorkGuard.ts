// "Is it safe to reload this admin tab right now?" - used by the new-version
// check (AdminLayout.tsx) so an update never throws away work. There is no
// per-page registry of unsaved forms in this app, so this tracks it generically:
//
//  - dirty: the user edited a form field (a trusted input/change event) and has not
//    saved since. Cleared by a SUCCESSFUL save (any non-GET /api/ request answering
//    2xx - auto-saved pages and staged "Save" buttons alike) or by navigating to
//    another page (the work on the old page is gone by then anyway).
//  - pending writes: a save or an upload (fetch or XMLHttpRequest, any non-GET
//    same-origin /api/ request) is in flight.
//
// Reload only when neither applies. Deliberately conservative: an edit that is
// abandoned without saving keeps the tab "dirty" until the user navigates, and the
// update is then applied at that navigation instead (full page load to the page
// they clicked).
let dirty = false
let pendingWrites = 0
let installs = 0
let teardown: (() => void) | null = null

export function isSafeToReload(): boolean {
  return !dirty && pendingWrites === 0
}

export function clearDirty(): void {
  dirty = false
}

export function noteWriteStart(): void {
  pendingWrites += 1
}

export function noteWriteEnd(succeeded: boolean): void {
  pendingWrites = Math.max(0, pendingWrites - 1)
  if (succeeded) dirty = false
}

// Test helper.
export function resetUnsavedWorkState(): void {
  dirty = false
  pendingWrites = 0
}

export function isTrackedWrite(method: string | undefined, pathname: string): boolean {
  return (method ?? 'GET').toUpperCase() !== 'GET' && pathname.startsWith('/api/')
}

export function installUnsavedWorkGuard(): () => void {
  installs += 1
  if (installs === 1) {
    const onEdit = (event: Event) => {
      if (!event.isTrusted) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) dirty = true
    }
    document.addEventListener('input', onEdit, true)
    document.addEventListener('change', onEdit, true)

    // Uploads go through XMLHttpRequest (UploadContext.tsx), saves through fetch
    // (counted in lib/adminFetchGuard.ts).
    const proto = XMLHttpRequest.prototype
    const originalOpen = proto.open
    const originalSend = proto.send
    proto.open = function (this: XMLHttpRequest & { __aicWrite?: boolean }, method: string, url: string | URL, ...rest: unknown[]) {
      try {
        this.__aicWrite = isTrackedWrite(method, new URL(String(url), window.location.origin).pathname)
      } catch {
        this.__aicWrite = false
      }
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest)
    } as typeof proto.open
    proto.send = function (this: XMLHttpRequest & { __aicWrite?: boolean }, body?: Document | XMLHttpRequestBodyInit | null) {
      if (this.__aicWrite) {
        noteWriteStart()
        this.addEventListener('loadend', () => noteWriteEnd(this.status >= 200 && this.status < 300), { once: true })
      }
      return originalSend.call(this, body)
    }

    teardown = () => {
      document.removeEventListener('input', onEdit, true)
      document.removeEventListener('change', onEdit, true)
      proto.open = originalOpen
      proto.send = originalSend
    }
  }
  return () => {
    installs -= 1
    if (installs === 0 && teardown) {
      teardown()
      teardown = null
    }
  }
}
