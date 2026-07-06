const STORAGE_KEY = 'shobdon-central.atc-reference-sample.v1'

export const REFERENCE_SAMPLE_FILENAME = 'weatherlink-reference.txt'

export interface AtcReferenceSample {
  rawText: string
  contentType: string | null
  capturedAt: string
}

export function loadReferenceSample(): AtcReferenceSample | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AtcReferenceSample
  } catch {
    return null
  }
}

export function saveReferenceSample(sample: AtcReferenceSample): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sample))
}

export function clearReferenceSample(): void {
  window.localStorage.removeItem(STORAGE_KEY)
}
