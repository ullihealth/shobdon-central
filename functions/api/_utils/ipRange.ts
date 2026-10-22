// Range labels (migration 0119): prefix normalisation + the SQL fragments that
// give every Visit Log query the same "effective label".
//
// Effective label precedence for an address:
//   exact ip_labels label  >  longest matching ip_range_labels prefix  >  none
// (the computed Robot / Test run chip, a display-only fallback, ranks below
// both and is handled in the page).

// Normalise user input to a stored prefix, or null if it isn't a valid range:
//   IPv4: 2 or 3 octets  -> "187.40." / "187.40.50."
//   IPv6: 1 to 4 groups  -> "2a00:d203:85fc:0:" (lowercase, no leading zeros,
//         no "::" - the address text must contain those groups explicitly)
// The trailing separator is what stops "187.40.5." matching 187.40.50.x.
export function normaliseRangePrefix(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  if (text.includes(":")) {
    const groups = text.replace(/:$/, "").split(":");
    if (groups.length < 1 || groups.length > 4) return null;
    if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map((g) => g.replace(/^0+(?=.)/, "")).join(":") + ":";
  }

  if (!/^\d{1,3}(\.\d{1,3}){1,2}\.?$/.test(text)) return null;
  const octets = text.replace(/\.$/, "").split(".").map(Number);
  if (octets.length < 2 || octets.length > 3 || octets.some((o) => o > 255)) return null;
  return octets.join(".") + ".";
}

// LEFT JOIN picking the single LONGEST matching range prefix for an address
// column (alias rl). Must come AFTER the exact-label join (alias l): the range
// lookup only runs for rows with NO exact label (an exact label always wins, so
// looking up a range for them would be wasted work - on production data most
// rows are exact-labelled). The subquery is correlated but ip_range_labels is
// tiny (a handful of rows).
export function rangeLabelJoin(ipColumn: string): string {
  return `LEFT JOIN ip_range_labels rl ON rl.id = CASE WHEN l.id IS NULL THEN (
           SELECT r2.id FROM ip_range_labels r2
           WHERE ${ipColumn} LIKE r2.prefix || '%'
           ORDER BY length(r2.prefix) DESC LIMIT 1) END`;
}

// With the exact-label join aliased `l` and the range join `rl`:
export const EFFECTIVE_GROUP_SQL = "COALESCE(l.group_name, rl.group_name)";
// "Unlabelled" = neither an exact nor a range label.
export const UNLABELED_SQL = "(l.id IS NULL AND rl.id IS NULL)";
// Where the effective label came from, and the range prefix when it is a range.
export const LABEL_SOURCE_SQL = "CASE WHEN l.id IS NOT NULL THEN 'ip' WHEN rl.id IS NOT NULL THEN 'range' END";

// Coverage ("distinct IPs seen") window used by the range-label previews/lists.
export const COVERAGE_DAYS = 30;
export function coverageCutoff(): string {
  return new Date(Date.now() - COVERAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
