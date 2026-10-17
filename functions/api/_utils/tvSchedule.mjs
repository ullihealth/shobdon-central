// TV wake/sleep schedule round (HDMI-CEC, migration 0114) - pure,
// side-effect-free schedule/time logic shared between the admin PATCH
// route (functions/api/platform/pi-units/[id].ts), the override route
// (functions/api/platform/pi-units/[id]/tv-schedule-override.ts), and
// the box poll route (functions/api/public/pi-units/tv-schedule.ts).
//
// Deliberately .mjs, not .ts, unlike every other file in this directory -
// tsconfig.json only `includes: ["src"]` (functions/ is never
// type-checked by tsc, only bundled by esbuild at deploy time), so a
// plain .mjs import from a .ts route file costs nothing at the bundler
// level - but it DOES let scripts/tv-schedule.test.mjs `import` this
// module directly in plain Node for the pure-function unit tests Jeff
// asked for, with no build step and no running `wrangler pages dev`
// needed for those specific tests (unlike every other test file here,
// which only ever exercises logic indirectly through a live HTTP route).

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Overnight schedules (sleep time earlier than wake time, e.g. wake
// 07:00/sleep 01:00 meaning "sleep the following calendar day") are
// REJECTED, not supported - decision made explicitly in the design
// round, not an oversight. Reason: supporting it would mean every piece
// of logic below (the per-day decision, the next-transition walk, "off
// all day") has to reason about a schedule entry that spans two
// calendar days, which is real added complexity for a feature that
// needs to ship reliably by Tuesday. A same-day-only schedule (sleep
// strictly after wake, both within one calendar day) covers every real
// TV-hours case this round's brief describes and keeps every function
// below a simple same-day comparison.
export function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== "object") return "schedule is required";
  for (const key of WEEKDAY_KEYS) {
    const day = schedule[key];
    if (!day || typeof day !== "object") return `missing schedule for ${key}`;
    if (typeof day.off !== "boolean") return `${key}.off must be a boolean`;
    if (!day.off) {
      if (typeof day.wake !== "string" || !TIME_RE.test(day.wake)) return `${key}.wake must be in HH:MM (24h) format`;
      if (typeof day.sleep !== "string" || !TIME_RE.test(day.sleep)) return `${key}.sleep must be in HH:MM (24h) format`;
      if (day.sleep <= day.wake) {
        return `${key}: sleep time must be after wake time on the same day - overnight schedules (sleep after midnight) aren't supported yet`;
      }
    }
  }
  return null;
}

const LONDON_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAY_ABBR_TO_KEY = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

// Reads a real UTC instant as its Europe/London wall-clock representation
// (BST/GMT handled automatically by Intl, which carries the IANA tz
// database - no manual DST math here).
export function utcToLondonParts(utcDate) {
  const parts = Object.fromEntries(LONDON_FORMATTER.formatToParts(utcDate).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekdayKey: WEEKDAY_ABBR_TO_KEY[parts.weekday],
  };
}

// Converts a Europe/London wall-clock date+time (e.g. "2026-07-01
// 07:00") to the real UTC instant it represents, DST-aware. Standard
// offset-correction technique (no timezone library available in
// Workers): treat the wall-clock numbers as if they were already UTC
// (`naive`), read what that instant actually displays as in London,
// and the difference between the two IS London's UTC offset at that
// instant - subtract it from the naive guess to get the real UTC
// instant. Known, accepted limitation: during the ~1 skipped/ambiguous
// hour on the two UK clock-change days themselves, a schedule time
// landing exactly in that hour can resolve to either side of the
// change - not worth more complexity for a once-a-year, minute-grained
// edge case under this round's own deadline.
export function londonWallTimeToUtc(year, month, day, hour, minute) {
  const naiveMs = Date.UTC(year, month - 1, day, hour, minute);
  const naive = new Date(naiveMs);
  const londonOfNaive = utcToLondonParts(naive);
  const londonOfNaiveMs = Date.UTC(londonOfNaive.year, londonOfNaive.month - 1, londonOfNaive.day, londonOfNaive.hour, londonOfNaive.minute);
  const offsetMs = londonOfNaiveMs - naiveMs;
  return new Date(naiveMs - offsetMs);
}

// Core decision: what should the TV be doing RIGHT NOW. An active
// override always wins over the recurring weekly schedule (an explicit
// one-off instruction from the admin outranks the recurring plan, and
// deliberately applies even when the weekly schedule itself is
// disabled/unset - see tv-schedule-override.ts's own comment on why
// that's useful for testing before a full week is configured). Returns
// 'wake' | 'sleep' | null (null = no schedule applies at all right now,
// caller must send no CEC command and leave the TV exactly as a human
// last left it - see this file's own header comment on "no fighting the
// remote").
export function computeDesiredState({ enabled, schedule, overrideState, overrideUntil }, nowUtcDate) {
  if (overrideState && overrideUntil && nowUtcDate.getTime() < new Date(overrideUntil).getTime()) {
    return overrideState;
  }
  if (!enabled || !schedule) return null;
  const parts = utcToLondonParts(nowUtcDate);
  const day = schedule[parts.weekdayKey];
  if (!day) return null;
  if (day.off) return "sleep";
  const nowMinutes = parts.hour * 60 + parts.minute;
  const [wakeHour, wakeMinute] = day.wake.split(":").map(Number);
  const [sleepHour, sleepMinute] = day.sleep.split(":").map(Number);
  const wakeMinutes = wakeHour * 60 + wakeMinute;
  const sleepMinutes = sleepHour * 60 + sleepMinute;
  return nowMinutes >= wakeMinutes && nowMinutes < sleepMinutes ? "wake" : "sleep";
}

// The next UTC instant, strictly after `nowUtcDate`, at which the
// RECURRING weekly schedule itself would transition (ignores any
// override - this is "what does the plain weekly plan say is next",
// used only to bound how long a Wake now/Sleep now override holds: it
// should release control back to the normal schedule at the next moment
// the schedule would have acted anyway, not an arbitrary fixed delay).
// Walks forward up to 8 calendar days (a full week plus one, so a
// same-day transition later today is found before wrapping) using pure
// calendar-date arithmetic for the day-stepping (never ambiguous, since
// it only adds whole calendar days to Y/M/D fields) and the DST-aware
// converter above only for the final wake/sleep instant on each
// candidate day. Returns null if disabled/unset, or if every day in the
// week is "off all day" (no transition exists to bound an override by).
export function computeNextTransition(schedule, enabled, nowUtcDate) {
  if (!enabled || !schedule) return null;
  const nowParts = utcToLondonParts(nowUtcDate);
  const baseCalendarUtc = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const calDate = new Date(baseCalendarUtc.getTime() + dayOffset * 86400000);
    const y = calDate.getUTCFullYear();
    const mo = calDate.getUTCMonth() + 1;
    const d = calDate.getUTCDate();
    const weekdayKey = WEEKDAY_KEYS[(calDate.getUTCDay() + 6) % 7]; // getUTCDay: 0=Sun..6=Sat -> Mon-first index
    const day = schedule[weekdayKey];
    if (!day || day.off) continue;
    for (const timeStr of [day.wake, day.sleep]) {
      const [hour, minute] = timeStr.split(":").map(Number);
      const candidateUtc = londonWallTimeToUtc(y, mo, d, hour, minute);
      if (candidateUtc.getTime() > nowUtcDate.getTime()) return candidateUtc;
    }
  }
  return null;
}

// Whether a new CEC command should be sent: the desired state differs
// from what was last actually commanded, OR nothing has been commanded
// yet this boot (lastCommand is null/undefined - exactly what
// /run/airfieldcentral-tv-schedule-last-commanded.json looks like
// immediately after every reboot, since it lives on tmpfs - see
// raspberry-pi/tv-schedule-check.py's own header comment for why this
// IS the after-boot/HDMI-hotplug re-assert mechanism). This is the
// exact rule that Python script's own run() implements against its
// local state file; mirrored here, unused by any real route, purely so
// this specific rule has direct, fast unit-test coverage in the same
// place as the rest of this module's logic.
export function shouldCommand(desired, lastCommand) {
  if (desired === null || desired === undefined) return false;
  return lastCommand === null || lastCommand === undefined || lastCommand !== desired;
}

// Workers has no Node `crypto.timingSafeEqual` - same manual
// constant-time comparison functions/api/stripe/webhook.ts's own
// verifyStripeSignature already uses in this codebase (length check
// first, then unconditional XOR over every byte), reused here rather
// than inventing a second version for the shared fleet key.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
