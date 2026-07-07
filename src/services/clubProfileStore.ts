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
        { colour: '#4caf50' }, // grass
        { colour: '#a8b4c4' }, // tarmac
      ],
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
    Array.isArray(group.strips) &&
    group.strips.every(
      (strip) => typeof strip === 'object' && strip !== null && typeof (strip as Record<string, unknown>).colour === 'string'
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
