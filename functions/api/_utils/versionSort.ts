// Shared numeric version comparator - extracted from
// functions/api/platform/updates/index.ts's own sort-bug-fix round so
// the new public functions/api/public/versions.ts endpoint uses the
// IDENTICAL correct sort rather than a second hand-rolled copy that
// could silently drift from this one. version is free-text (whatever
// the developer types into the release form - see release.ts), so it
// can't be sorted correctly with a plain SQL/string ORDER BY:
// 'v1.10.0' < 'v1.2.0' lexicographically, since '1' < '2' at the first
// differing character. Segment-by-segment numeric comparison instead,
// with the optional leading 'v' stripped so it handles free-text
// variation gracefully; non-numeric segments fall back to 0 rather
// than throwing.
export function parseVersionSegments(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((segment) => {
      const n = parseInt(segment, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

// Descending (newest version first) - returns negative when `a` is the
// newer version, matching Array.prototype.sort's "negative means a
// comes first" contract.
export function compareVersionsDesc(a: string, b: string): number {
  const segmentsA = parseVersionSegments(a);
  const segmentsB = parseVersionSegments(b);
  const length = Math.max(segmentsA.length, segmentsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (segmentsB[i] ?? 0) - (segmentsA[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
