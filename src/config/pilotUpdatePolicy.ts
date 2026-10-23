// ONE switch for how a Pilot's App RELEASE reaches phones that already have the
// app open.
//
//   true  (current) - the moment an open app notices a new release is waiting
//                     (its pilot-sw.js changed - which only happens when a new
//                     version is released in Developer Features, see
//                     scripts/stamp-pilot-sw.mjs), it shows "Updating to the
//                     latest version…" and reloads itself onto the new build.
//                     No tap needed. This is the "release forces an update for
//                     every tenant" behaviour.
//   false           - the app instead shows the large "A new version of the app
//                     is available" box with an "Update now" button, and only
//                     reloads when the pilot taps it (the old tap-only rule, but
//                     with a prominent box instead of a thin strip).
//
// Developer "Force Pilot App update" (Platform -> Tenants) is independent of
// this switch and always works.
export const AUTO_FORCE_UPDATE_ON_RELEASE = true
