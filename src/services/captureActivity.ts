// Tracks whether a WeatherLink capture is currently mid-fetch, so unrelated
// features (e.g. remote refresh polling) can avoid interrupting it. Plain
// module state, not React state - nothing here should trigger a re-render.
let captureInProgress = false

export function setCaptureInProgress(value: boolean): void {
  captureInProgress = value
}

export function isCaptureInProgress(): boolean {
  return captureInProgress
}
