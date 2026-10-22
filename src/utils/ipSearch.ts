// Pure helpers for the Visit Log's four-box IP search (IpSearchInput.tsx).

export type IpBoxes = [string, string, string, string]

export const EMPTY_IP_BOXES: IpBoxes = ['', '', '', '']

// Prefix sent to the server (matched as "starts with"), built left to right
// from the filled boxes, stopping at the first empty one:
//   148 + 252      -> "148.252."   (a box with 3 digits is a finished octet)
//   148 + 25       -> "148.25"     (last box still being typed: no dot, so it
//                                   matches 148.25.x and 148.252.x)
//   187 192 1 3    -> "187.192.1.3"
// A short octet FOLLOWED by a filled box is finished too ("1" then "3" ->
// "1.3"), which is what Tab / "." on a short box means.
export function buildIpPrefix(boxes: readonly string[]): string {
  const parts: string[] = []
  for (const box of boxes) {
    if (box === '') break
    parts.push(box)
  }
  if (parts.length === 0) return ''
  const joined = parts.join('.')
  const last = parts[parts.length - 1]
  return last.length === 3 && parts.length < 4 ? `${joined}.` : joined
}

export function digitsOnly(value: string, max = 3): string {
  return value.replace(/\D/g, '').slice(0, max)
}

// Pasted text -> boxes, or the IPv6 fallback.
//  - contains ":"        -> { ipv6: text } (single text field)
//  - contains "."        -> fills from the FIRST box ("187.192.1.3", "148.252")
//  - plain digits        -> goes into the box that was pasted into only
export function parsePastedIp(
  text: string,
  targetIndex: number
): { ipv6: string } | { boxes: IpBoxes; focusIndex: number } {
  const trimmed = text.trim()
  if (trimmed.includes(':')) return { ipv6: trimmed }
  if (trimmed.includes('.')) {
    const boxes: IpBoxes = ['', '', '', '']
    trimmed
      .split('.')
      .slice(0, 4)
      .forEach((part, i) => {
        boxes[i] = digitsOnly(part)
      })
    const filled = boxes.filter((b) => b !== '').length
    return { boxes, focusIndex: Math.min(filled, 3) }
  }
  const boxes: IpBoxes = ['', '', '', '']
  boxes[targetIndex] = digitsOnly(trimmed)
  return { boxes, focusIndex: targetIndex }
}
