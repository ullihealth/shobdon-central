import { fetchWithTimeout } from './fetchWithTimeout'

export interface AtcConnectionTestResult {
  ok: boolean
  status: number | null
  statusText: string | null
  contentType: string | null
  characterEncoding: string | null
  responseSizeBytes: number | null
  responseTimeMs: number
  retrievedAt: Date
  rawText: string | null
  errorMessage: string | null
  pageProtocol: string
  userAgent: string
  localNetworkAccessState: 'granted' | 'denied' | 'prompt' | 'unsupported'
}

async function queryLocalNetworkAccessState(): Promise<AtcConnectionTestResult['localNetworkAccessState']> {
  try {
    const status = await navigator.permissions.query({ name: 'local-network-access' as PermissionName })
    return status.state as 'granted' | 'denied' | 'prompt'
  } catch {
    return 'unsupported'
  }
}

function extractCharset(contentType: string | null): string | null {
  if (!contentType) return null
  const match = contentType.match(/charset=([^;]+)/i)
  return match ? match[1].trim() : null
}

/**
 * Developer-only diagnostic fetch of the raw WeatherLink station response.
 * Deliberately does not call parseAdispResponse - this exists purely to help
 * capture a real sample so that parser can be written.
 */
export async function testAtcConnection(stationUrl: string, timeoutMs: number): Promise<AtcConnectionTestResult> {
  const startedAt = performance.now()
  const pageProtocol = window.location.protocol
  const userAgent = navigator.userAgent
  const localNetworkAccessState = await queryLocalNetworkAccessState()

  try {
    const response = await fetchWithTimeout(stationUrl, timeoutMs)
    const rawText = await response.text()
    const contentType = response.headers.get('content-type')

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || null,
      contentType,
      characterEncoding: extractCharset(contentType),
      responseSizeBytes: new Blob([rawText]).size,
      responseTimeMs: Math.round(performance.now() - startedAt),
      retrievedAt: new Date(),
      rawText,
      errorMessage: null,
      pageProtocol,
      userAgent,
      localNetworkAccessState,
    }
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError'
    return {
      ok: false,
      status: null,
      statusText: null,
      contentType: null,
      characterEncoding: null,
      responseSizeBytes: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      retrievedAt: new Date(),
      rawText: null,
      errorMessage: timedOut
        ? `Timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown error',
      pageProtocol,
      userAgent,
      localNetworkAccessState,
    }
  }
}
