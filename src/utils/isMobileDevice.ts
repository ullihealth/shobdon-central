// Phone user agents only - deliberately excludes iPad (which has
// masqueraded as desktop Safari's own UA string since iPadOS 13, so it
// would never match this anyway) and Android tablets. Requires "Mobile"
// alongside "Android" rather than matching "Android" alone, since most
// Android tablets omit "Mobile" from their UA while phones include it -
// matching bare "Android" would misclassify every Android tablet as a
// phone.
const PHONE_USER_AGENT_PATTERN = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile|Opera Mini/i

// No real phone's short edge exceeds this (largest current phones, e.g.
// iPhone Pro Max, are ~430 CSS px) while the smallest real tablets
// (iPad mini portrait) start at 768 - comfortable margin either way.
const PHONE_MAX_SHORT_EDGE_PX = 480

// RootRoute.tsx's own redirect-to-/pilot check. Two signals, both
// required (not either/or): the user agent is the primary signal
// (actual phone detection, not a viewport guess), and screen width is a
// secondary CONFIRMING check, not a fallback - it exists to catch the
// cases a UA string alone gets wrong, not to replace the UA check. Two
// specific cases motivated this:
//   - A tablet in portrait whose UA happens to include "Mobile" anyway
//     (some Android tablets do) - the short-edge check still correctly
//     reads as tablet-sized and vetoes the phone classification.
//   - A resized desktop browser window - never an issue for the UA gate
//     itself (resizing a window doesn't change navigator.userAgent), but
//     using window.screen.width/height here (the device's actual screen,
//     not window.innerWidth/innerHeight) means even the width check
//     itself can't be tricked by a narrowed browser window in devtools.
// Math.min(width, height), not width alone, so a phone held in landscape
// (where width temporarily exceeds height) still measures against its
// own short edge rather than failing the check on rotation.
export function isMobileDevice(): boolean {
  if (!PHONE_USER_AGENT_PATTERN.test(navigator.userAgent)) return false
  const shortEdge = Math.min(window.screen.width, window.screen.height)
  return shortEdge <= PHONE_MAX_SHORT_EDGE_PX
}
