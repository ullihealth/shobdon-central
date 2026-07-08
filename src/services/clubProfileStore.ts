import type { ClubProfile, RunwayGroup } from '../types/clubProfile'

const STORAGE_KEY = 'shobdon-central.club-profile.v1'

// Shobdon's real runway: twin grass/tarmac strips, same heading, magnetic
// 083°/263°. This is the seeded default the app ships with - RunwaysPage
// writes back to the same key, so nothing else needs to change to pick up
// admin edits.
export const DEFAULT_CLUB_PROFILE: ClubProfile = {
  runwayGroups: [
    {
      id: 'shobdon-08-26',
      label: '08/26',
      headingDegrees: 83,
      twin: true,
      strips: [
        // Exact current literal width from CompassPanel.tsx's Shobdon-seeded
        // geometry (was hardcoded width="22" for both) - seeding these keeps
        // default rendering byte-identical now that width is per-strip, not
        // shared across the group.
        { colour: '#4caf50', widthPx: 22 }, // grass
        { colour: '#a8b4c4', widthPx: 22 }, // tarmac
      ],
      // Exact current length: RING_RADIUS * 0.6 * 2 = 180 * 0.6 * 2 = 216,
      // CompassPanel.tsx's existing RUNWAY_STRIP_HALF_LENGTH-derived value
      // before it became per-group - seeding this keeps default rendering
      // byte-identical now that length is configurable too.
      stripLengthPx: 216,
      hasThresholdMarkings: false,
      showIdentifierLabels: true,
      // Exact current literal font size from CompassPanel.tsx's runway
      // number <text> elements (was hardcoded fontSize="14") - seeding
      // this keeps default rendering byte-identical now it's per-group.
      identifierFontSizePx: 14,
    },
  ],
}

function isValidRunwayGroup(value: unknown): value is RunwayGroup {
  if (!value || typeof value !== 'object') return false
  const group = value as Record<string, unknown>
  return (
    typeof group.id === 'string' &&
    typeof group.label === 'string' &&
    typeof group.headingDegrees === 'number' &&
    typeof group.twin === 'boolean' &&
    typeof group.stripLengthPx === 'number' &&
    typeof group.hasThresholdMarkings === 'boolean' &&
    typeof group.showIdentifierLabels === 'boolean' &&
    typeof group.identifierFontSizePx === 'number' &&
    Array.isArray(group.strips) &&
    group.strips.every(
      (strip) =>
        typeof strip === 'object' &&
        strip !== null &&
        typeof (strip as Record<string, unknown>).colour === 'string' &&
        typeof (strip as Record<string, unknown>).widthPx === 'number'
    )
  )
}

export function loadClubProfile(): ClubProfile {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CLUB_PROFILE

    const parsed = JSON.parse(raw)
    const runwayGroups = parsed?.runwayGroups
    if (!Array.isArray(runwayGroups) || runwayGroups.length === 0 || !runwayGroups.every(isValidRunwayGroup)) {
      return DEFAULT_CLUB_PROFILE
    }

    return { runwayGroups }
  } catch {
    return DEFAULT_CLUB_PROFILE
  }
}

export function saveClubProfile(profile: ClubProfile): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
}
