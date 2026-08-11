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
// they never depended on it to begin with).
//
// That fix only ever covered 0/1 and 2/3 though - it left codes 7
// (Cloudy) and 8 (Overcast) exactly as they'd always been, one fixed
// glyph regardless of time, because Met Office's OWN scheme has no
// night-paired code for either of those at all (confirmed against the
// official code table) - there was no code-embedded signal to use.
// Round 2 of this same underlying bug (reported live, a cloudy evening
// after sunset still showing 🌥️): isDaytime is now computed independently
// (solarPosition.ts, server-side, from each hour's own timestamp and the
// tenant's real coordinates - see publicVisibilityForecast.ts) precisely
// because Met Office's code can't supply it for these two. At night, both
// fall back to the same bare 🌙 codes 0/2 already use - there's no
// "cloudy moon" emoji in Unicode to reach for instead (checked), and
// reusing the existing clear-night glyph is the same compromise this file
// already makes for 0 vs 2 (a genuinely clear night and a partly-cloudy
// night render identically today too, for the identical reason).
//
// Codes 9-30 (drizzle/rain/sleet/hail/snow/thunder) are deliberately NOT
// given the same isDaytime treatment, even though several of those ARE
// real day/night pairs in Met Office's own table (9/10, 13/14, 16/17,
// 19/20, 22/23, 25/26, 28/29) - confirmed against the official Met Office
// DataPoint code-definitions reference before shipping either version of
// this file. Falling back to bare 🌙 at night here, the same move made for
// 7/8 above, would DESTROY real information for these: unlike "cloudy"
// (where the icon only ever tells you cloud cover), the weather-TYPE glyph
// here (🌧️/🧊/❄️/⛈️) is the entire point of showing an icon at all - a
// pilot or café patron seeing a plain moon instead of a thunderstorm glyph
// for a 2am thunder shower is a worse outcome than the current "shows
// thunder at 2am and 2pm alike", not a fix. Same "one glyph per weather
// TYPE regardless of time" stance as before for this range; isDaytime is
// accepted as a parameter here for symmetry/future use but genuinely does
// not change the result for any code in this range.
export function weatherIconFor(code: number | undefined, isDaytime?: boolean): string {
  if (code === undefined) return '–'
  switch (code) {
    case 0: return '🌙' // Clear night
    case 1: return '☀️' // Sunny day
    case 2: return '🌙' // Partly cloudy (night)
    case 3: return '⛅' // Partly cloudy (day)
    case 5: return '🌫️' // Mist
    case 6: return '🌫️' // Fog
    case 7: return isDaytime === false ? '🌙' : '🌥️' // Cloudy - no official night code, computed instead
    case 8: return isDaytime === false ? '🌙' : '☁️' // Overcast - same
    default: break
  }
  if (code >= 9 && code <= 15) return '🌧️' // Drizzle / rain, light-heavy (real day/night pairs exist upstream, deliberately not distinguished here - see comment above)
  if (code >= 16 && code <= 21) return '🧊' // Sleet / hail (same)
  if (code >= 22 && code <= 27) return '❄️' // Snow (same)
  if (code >= 28 && code <= 30) return '⛈️' // Thunder (same)
  return '❓' // Unmapped (e.g. code 4, not used by the API)
}
