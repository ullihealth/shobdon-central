// Client-side helpers for Visit Log range labels (migration 0119). The server
// (functions/api/_utils/ipRange.ts) is the authority on validation and
// matching; these only build the prefixes the UI offers and the faint
// "same range" suggestions.

export interface RangeChoice {
  scope: 'three' | 'two'
  prefix: string // normalised, trailing separator
  label: string // e.g. "First 3 octets (187.40.50.x)"
}

// Range prefixes offered for one address:
//   IPv4  -> first 3 octets, first 2 octets
//   IPv6  -> first 4 groups (needs 4 explicit groups before any "::")
export function rangeChoicesForIp(ip: string): RangeChoice[] {
  if (ip.includes(':')) {
    const groups = ip.toLowerCase().split(':')
    if (ip.includes('::') && groups.indexOf('') < 4 && groups.indexOf('') !== -1) return []
    if (groups.length < 5 || groups.slice(0, 4).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return []
    const prefix = groups.slice(0, 4).join(':') + ':'
    return [{ scope: 'three', prefix, label: `First 4 groups (${prefix}…)` }]
  }
  const octets = ip.split('.')
  if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o))) return []
  return [
    { scope: 'three', prefix: `${octets.slice(0, 3).join('.')}.`, label: `First 3 octets (${octets.slice(0, 3).join('.')}.x)` },
    { scope: 'two', prefix: `${octets.slice(0, 2).join('.')}.`, label: `First 2 octets (${octets.slice(0, 2).join('.')}.x.x)` },
  ]
}

// The "tight" range used for suggestions: first 3 IPv4 octets / first 4 IPv6 groups.
export function suggestionRangeKey(ip: string): string | null {
  const choices = rangeChoicesForIp(ip)
  return choices.length > 0 ? choices[0].prefix : null
}

// A group to suggest for an UNLABELLED address: the most common group among
// EXACT labels that share its tight range (never the address's own label -
// it has none). null when there is nothing to suggest.
export function suggestRangeGroup(ip: string, exactLabels: { ipAddress: string; groupName: string }[]): string | null {
  const key = suggestionRangeKey(ip)
  if (!key) return null
  const counts = new Map<string, number>()
  for (const label of exactLabels) {
    if (label.ipAddress === ip || !label.ipAddress.startsWith(key)) continue
    counts.set(label.groupName, (counts.get(label.groupName) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [group, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && group < best)) {
      best = group
      bestCount = count
    }
  }
  return best
}
