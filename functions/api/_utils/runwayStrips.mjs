// Runway strip rules shared by every server route that stores runway groups
// (deliberately .mjs, like tvSchedule.mjs, so plain Node can import it in the
// test suite with no build step). The client has its own small copy of the
// count rule in src/utils/runwayStrips.ts - functions/ and src/ are separate
// build contexts in this repo and don't import across that boundary.
//
// A runway has 1, 2 or 3 parallel strips (migration-free: runway_groups.twin
// stays 0/1 and stripsJson is already an open array).
export const MAX_RUNWAY_STRIPS = 3;

// Same rule the dashboard uses: 3 strips in the array = 3; otherwise the
// stored `twin` flag decides 1 vs 2 (so every row saved before three strips
// existed keeps resolving exactly as it always did).
export function runwayStripCount(group) {
  if (Array.isArray(group?.strips) && group.strips.length >= MAX_RUNWAY_STRIPS) return 3;
  return group?.twin ? 2 : 1;
}

// Returns an error message, or null when the whole runwayGroups array is
// acceptable. Called BEFORE the destructive delete-and-reinsert in
// tenant/config.ts so a bad request can never wipe a tenant's runways.
// Accepts 1-3 strips per runway and nothing else; a 3-strip runway must have
// twin = true (older cached dashboards only understand twin/non-twin, and the
// stored flag must never contradict the array). It does NOT insist that twin
// = (strips > 1) for 1-2 strips, because rows saved before this rule existed
// are valid as they stand and must stay re-savable.
export function validateRunwayGroups(groups) {
  if (!Array.isArray(groups)) return "runwayGroups must be an array";
  for (const [index, group] of groups.entries()) {
    const label = `Runway ${index + 1}`;
    if (!group || typeof group !== "object") return `${label}: must be an object`;
    if (!Array.isArray(group.strips)) return `${label}: strips must be an array`;
    if (group.strips.length < 1 || group.strips.length > MAX_RUNWAY_STRIPS) {
      return `${label}: a runway needs 1 to ${MAX_RUNWAY_STRIPS} strips (got ${group.strips.length})`;
    }
    if (group.strips.some((strip) => !strip || typeof strip !== "object" || Array.isArray(strip))) {
      return `${label}: each strip must be an object`;
    }
    if (group.strips.length === MAX_RUNWAY_STRIPS && !group.twin) {
      return `${label}: a 3-strip runway must have twin set to true`;
    }
  }
  return null;
}
