// Pilot App NOTAM readability round - the raw feed (functions/api/public/
// notams.ts, notaminfo.com) renders NOTAM body text largely in solid
// UPPERCASE, sometimes with a few already-mixed-case tokens mixed in
// (confirmed against real live pulls - not every source NOTAM is
// uniformly caps throughout). This is display-only: converts to sentence
// case for readability WITHOUT touching the stored/fetched data, and is
// applied ONLY in AutoNotamsScrollPanel.tsx (the Pilot App's own NOTAM
// card) - RightInfoPanel.tsx's Reception Dashboard/ATC NOTAM rendering
// is untouched, unless/until that's separately asked for.
//
// Deliberately lowercases every non-preserved token regardless of its
// ORIGINAL casing (not just genuinely-all-caps source tokens) - some
// real NOTAMs mix fully-uppercase and partially-mixed-case text within
// the same body (e.g. "...LOWER: 1,500 Feet AMSL..."), and treating
// "Feet" as already-fine because it wasn't yelling-caps would leave the
// output inconsistently cased depending on which upstream source
// happened to format that one NOTAM differently.

// Explicit multi-word preserve-list (per spec) - in practice, both of
// the spec's own named examples ("A/G COM", "AFIS") already happen to
// be covered by the short-all-caps-token rule below on their own
// ("A/G" and "COM" each strip to a 2-3 char all-caps core; "AFIS" is 4
// chars all-caps) - this list exists for a genuinely multi-part term
// that DOESN'T decompose that way if one ever turns up in testing or a
// future feed item. Extend here, not by hand-editing the regex logic.
const PRESERVE_PHRASES = ['A/G COM']

const MONTH_ABBREVIATIONS = new Set([
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
])

// Real, observed false-positive case: since the source text is often
// ENTIRELY uppercase to begin with, the "short all-caps token" rule
// below would otherwise also preserve ANY short word purely because the
// surrounding text is yelling - not just connective words (FOR, BY, TO,
// OF...) but ordinary short CONTENT words too (AREA, INFO, LOWER,
// UPPER, RADIO, USE - all confirmed showing up wrongly preserved
// against real NOTAM text during testing). This list is what actually
// makes the length+case heuristic mean "looks like an abbreviation/
// code" rather than "is a short word" - inherently a heuristic, not a
// closed set (a rare short common word could still slip through
// uncaught); extend here if testing surfaces another one, same as the
// aviation preserve-list above.
const COMMON_SHORT_WORDS = new Set([
  // function/connective words
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'is', 'are', 'was', 'were', 'be', 'been',
  'for', 'and', 'or', 'nor', 'but', 'if', 'as', 'it', 'its', 'this', 'that', 'all', 'any', 'per',
  'via', 'not', 'no', 'due', 'can', 'may', 'will', 'with', 'from', 'up', 'out', 'off', 'over',
  'into', 'onto', 'near', 'both', 'each', 'has', 'had', 'do', 'does', 'when', 'then', 'than',
  'also', 'only', 'same', 'once', 'ever', 'else', 'less', 'much', 'many', 'very', 'just', 'even',
  'whom', 'whose', 'where', 'which', 'would', 'could', 'shall', 'must', 'might', 'done', 'made',
  'take', 'give', 'come', 'held', 'kept', 'so', 'we', 'us', 'you', 'he', 'she', 'they', 'them',
  'his', 'her', 'our', 'your', 'their',
  // ordinary short CONTENT words plausible in NOTAM-style operational
  // prose (not aviation-specific abbreviations) - the actual source of
  // every false positive found during testing.
  'area', 'info', 'lower', 'upper', 'radio', 'use', 'used', 'unit', 'point', 'until', 'after',
  'date', 'time', 'zone', 'site', 'road', 'path', 'line', 'note', 'part', 'open', 'shut', 'safe',
  'risk', 'plan', 'work', 'task', 'need', 'more', 'most', 'some', 'such', 'stop', 'start', 'close',
  'end', 'mid', 'week', 'month', 'year', 'day', 'days', 'hour', 'hours', 'min', 'mins', 'high',
  'low', 'wide', 'long', 'short', 'east', 'west', 'north', 'south', 'side', 'edge', 'clear',
  'block', 'level', 'range', 'local', 'daily', 'until', 'apply', 'valid', 'issue', 'issued',
])

// A control character that can never legitimately appear in fetched
// NOTAM text - safe as a placeholder wrapper that survives the
// whitespace-split pass below as exactly one token (unlike a plain
// space, which would itself get split apart from the digit it's meant
// to wrap).
const PLACEHOLDER_MARKER = ''

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripPunctuation(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
}

// Decides whether a whitespace-delimited token should be shown exactly
// as the feed wrote it (never re-cased) - coordinates, dates, times,
// reference numbers, quantities, and short abbreviation/ICAO-style
// codes. Everything else is ordinary prose, safe to lowercase and
// sentence-case.
function isPreservedToken(token: string): boolean {
  const core = stripPunctuation(token)
  if (!core) return false

  // Coordinate component, e.g. 523207N, 0024717W.
  if (/^\d+[NSEW]$/i.test(core)) return true

  // Any digit at all - covers dates ("28"), times ("09:00", "0900-1600"),
  // reference codes ("AR-2026-7683/01"), quantities ("1,500"), and phone
  // numbers ("07969", "664202") without needing to enumerate every shape
  // - "numbers, dates, times... left exactly as-is" per spec.
  if (/\d/.test(core)) return true

  // Month abbreviation, whatever casing the source happens to use for
  // it - it's part of a date either way.
  if (MONTH_ABBREVIATIONS.has(core.toLowerCase())) return true

  // Short abbreviation/ICAO-style code: genuinely all-caps in the
  // source (so an ordinary lowercase short word never matches this),
  // 2-5 characters, contains at least one letter, and isn't one of the
  // common short English words the source's own blanket uppercasing
  // would otherwise falsely catch (see COMMON_SHORT_WORDS above).
  if (
    core.length >= 2 &&
    core.length <= 5 &&
    /[A-Z]/.test(core) &&
    core === core.toUpperCase() &&
    !COMMON_SHORT_WORDS.has(core.toLowerCase())
  ) {
    return true
  }

  return false
}

const SENTENCE_END_PATTERN = /[.!?]['")\]]?$/
const PLACEHOLDER_PATTERN = new RegExp(`^${PLACEHOLDER_MARKER}(\\d+)${PLACEHOLDER_MARKER}$`)
const PLACEHOLDER_RESTORE_PATTERN = new RegExp(`${PLACEHOLDER_MARKER}(\\d+)${PLACEHOLDER_MARKER}`, 'g')

export function formatNotamTextForDisplay(rawText: string): string {
  if (!rawText) return rawText

  // Swap explicit preserve-list phrases for placeholders first, so the
  // word-by-word pass below can't split or re-case them - restored
  // verbatim at the end.
  const placeholders: string[] = []
  let working = rawText
  for (const phrase of PRESERVE_PHRASES) {
    const pattern = new RegExp(escapeRegExp(phrase), 'g')
    working = working.replace(pattern, (match) => {
      placeholders.push(match)
      return `${PLACEHOLDER_MARKER}${placeholders.length - 1}${PLACEHOLDER_MARKER}`
    })
  }

  const segments = working.split(/(\s+)/)
  let capitalizeNext = true

  const rebuilt = segments
    .map((segment) => {
      if (segment === '' || /^\s+$/.test(segment)) return segment
      if (PLACEHOLDER_PATTERN.test(segment)) return segment

      if (isPreservedToken(segment)) {
        capitalizeNext = SENTENCE_END_PATTERN.test(segment)
        return segment
      }

      let lowered = segment.toLowerCase()
      if (capitalizeNext) {
        const firstLetterIndex = lowered.search(/[a-z]/)
        if (firstLetterIndex !== -1) {
          lowered = lowered.slice(0, firstLetterIndex) + lowered[firstLetterIndex].toUpperCase() + lowered.slice(firstLetterIndex + 1)
        }
      }
      capitalizeNext = SENTENCE_END_PATTERN.test(segment)
      return lowered
    })
    .join('')

  return rebuilt.replace(PLACEHOLDER_RESTORE_PATTERN, (_, index: string) => placeholders[Number(index)])
}
