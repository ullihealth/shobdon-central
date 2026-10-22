// UK local day (Europe/London, BST/GMT handled by the platform's own tz
// database) -> the UTC instants bounding it. Used by the Visit Log's daily
// unique-device counter (platform/visits/daily-devices.ts); the Visit Log's
// own From/To filters stay on UTC days, unchanged.

const LONDON_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// London's offset from UTC at a given instant, in ms (0 in winter, +1h in BST).
function londonOffsetMs(instant: Date): number {
  const parts: Record<string, number> = {};
  for (const p of LONDON_FORMAT.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// UTC instant of 00:00 London time on the given calendar day. DST changes
// happen at 01:00 UTC, i.e. never before London midnight, so the offset
// in force at 00:00 UTC of that date is always the one in force at London
// midnight.
function londonMidnightUtc(year: number, month: number, day: number): Date {
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  return new Date(utcMidnight.getTime() - londonOffsetMs(utcMidnight));
}

// Null for anything that isn't a real YYYY-MM-DD calendar date.
// startIso inclusive, endIso EXCLUSIVE (next London midnight) - same ISO
// string format display_visits.visited_at is stored in, so plain string
// comparison in SQL is correct.
export function londonDayWindow(date: string): { startIso: string; endIso: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const start = londonMidnightUtc(year, month, day);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const end = londonMidnightUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
