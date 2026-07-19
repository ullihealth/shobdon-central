// Extracted from CloudVisibilityChart.tsx (the main dashboard's 6-Hour
// Forecast row) so the café ticker's forecast slot (Part A) can reuse
// the EXACT same day/night-aware icon set rather than a duplicate one -
// this is the single source of truth for Met Office Significant Weather
// Code -> icon, both callers import it from here.

// Previously collapsed every day/night-paired code to one glyph each
// (the comment here used to read "this dashboard doesn't need night/day
// to render differently") - that's what showed a sun icon for +3h..+6h
// on a 19:39 BST evening in July: code 0 ("Clear night") and code 1
// ("Sunny day") both rendered as ☀️, discarding the night/day
// distinction Met Office's Significant Weather Code already encodes
// directly in the code value itself, computed server-side from
// Shobdon's real coordinates against genuine sunrise/sunset - not from
// any client clock, so there's no timezone dependency to get right here
// at all; using the code as-is is correct on any viewing device
// regardless of its own system clock/timezone (verified by testing with
// the browser's own timezone changed - the icons don't move, because
// they never depended on it to begin with). Only clear/partly-cloudy
// have a day/night pair worth distinguishing visually (0/1, 2/3) -
// every other pair (e.g. 28/29, confirmed against the official Met
// Office DataPoint code-definitions reference) still renders one glyph
// per weather TYPE regardless of time, same as before; rain looks like
// rain whether it's 2pm or 2am.
export function weatherIconFor(code: number | undefined): string {
  if (code === undefined) return '–'
  switch (code) {
    case 0: return '🌙' // Clear night
    case 1: return '☀️' // Sunny day
    case 2: return '🌙' // Partly cloudy (night)
    case 3: return '⛅' // Partly cloudy (day)
    case 5: return '🌫️' // Mist
    case 6: return '🌫️' // Fog
    case 7: return '🌥️' // Cloudy
    case 8: return '☁️' // Overcast
    default: break
  }
  if (code >= 9 && code <= 15) return '🌧️' // Drizzle / rain, light-heavy (no day/night pair)
  if (code >= 16 && code <= 21) return '🧊' // Sleet / hail (no day/night pair)
  if (code >= 22 && code <= 27) return '❄️' // Snow (no day/night pair)
  if (code >= 28 && code <= 30) return '⛈️' // Thunder (no day/night pair)
  return '❓' // Unmapped (e.g. code 4, not used by the API)
}
