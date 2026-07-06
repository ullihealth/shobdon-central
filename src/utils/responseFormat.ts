const HEX_BYTES_PER_ROW = 16

export type DetectedResponseFormat = 'HTML' | 'XML' | 'JSON' | 'Plain Text'

/**
 * Guesses the format of a diagnostic response using the Content-Type header
 * first, falling back to sniffing the first non-whitespace characters when
 * the header is missing or generic (many embedded weather stations reply
 * with text/plain regardless of the actual body shape).
 */
export function detectResponseFormat(contentType: string | null, rawText: string | null): DetectedResponseFormat {
  const type = contentType?.toLowerCase() ?? ''
  if (type.includes('html')) return 'HTML'
  if (type.includes('xml')) return 'XML'
  if (type.includes('json')) return 'JSON'

  const trimmed = rawText?.trimStart() ?? ''
  if (trimmed.startsWith('<?xml')) return 'XML'
  if (trimmed.startsWith('<')) return trimmed.slice(0, 15).toLowerCase().includes('html') ? 'HTML' : 'XML'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'JSON'

  return 'Plain Text'
}

/**
 * Renders text as a classic hex dump (offset / hex bytes / ASCII gutter) so
 * non-printable bytes and unexpected delimiters from embedded systems are
 * visible instead of being silently swallowed by the browser's text decoding.
 */
export function toHexDump(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const rows: string[] = []

  for (let offset = 0; offset < bytes.length; offset += HEX_BYTES_PER_ROW) {
    const chunk = bytes.slice(offset, offset + HEX_BYTES_PER_ROW)
    const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(HEX_BYTES_PER_ROW * 3 - 1, ' ')
    const ascii = Array.from(chunk, (byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('')
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`)
  }

  return rows.length > 0 ? rows.join('\n') : ''
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
