// Standard NOAA solar position formula (https://gml.noaa.gov/grad/solcalc/solareqns.PDF),
// implemented directly rather than adding a dependency (suncalc et al) - this
// app already has an established pattern of small self-contained astronomy/
// physics utilities (windCalculations.ts, cloudBase.ts) rather than pulling
// in a library for one well-defined calculation, and the result here is a
// single boolean, not a full sunrise/sunset UI feature that would benefit
// from a richer API surface.
//
// Purely UTC-based throughout (getUTCFullYear/getUTCHours, never a local-
// timezone method) - this runs in a Cloudflare Pages Function, so there's
// no "local timezone" to accidentally depend on in the first place, but
// being explicit here matches this codebase's own established discipline
// around timezone-dependent bugs (see AIRFIELD_TIMEZONE's own history).
//
// Verified against known reference points before use: Greenwich/equator on
// the March 2026 equinox both cross day/night within ~15 minutes of the
// textbook 06:00/18:00 UTC, and Shobdon's computed summer solstice day
// length (~16.5h) matches the real known value for that latitude - not
// just trusted from the formula alone.
export function isDaytimeAt(utcMs: number, latitudeDeg: number, longitudeDeg: number): boolean {
  const date = new Date(utcMs);
  const startOfYearUTC = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((utcMs - startOfYearUTC) / 86400000) + 1;
  const hourUTC = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUTC - 12) / 24);

  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const timeOffsetMin = eqTimeMin + 4 * longitudeDeg;
  const trueSolarTimeMin = hourUTC * 60 + timeOffsetMin;
  const hourAngleDeg = trueSolarTimeMin / 4 - 180;
  const hourAngleRad = (hourAngleDeg * Math.PI) / 180;
  const latRad = (latitudeDeg * Math.PI) / 180;

  // cosZenith > 0 <=> zenith angle < 90 degrees <=> sun above the geometric
  // horizon. Deliberately the plain geometric horizon, not the ~90.833 deg
  // (refraction + solar disk radius) civil-sunrise/sunset convention -
  // this is choosing between a sun/moon WEATHER ICON, not publishing an
  // official sunrise time, and the ~2-3 minute difference at the margin
  // doesn't matter for that.
  const cosZenith = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  return cosZenith > 0;
}

// Same NOAA formula as isDaytimeAt above, but solved the other direction:
// isDaytimeAt tests the sign of cosZenith at one instant; this instead
// solves cosZenith = 0 for the hour angle, giving the two UTC instants
// (sunrise, sunset) where the sun crosses the geometric horizon on the
// calendar UTC day dateUtcMs falls on. Deliberately duplicates the
// declination/equation-of-time math above rather than factoring it out
// into a shared helper - isDaytimeAt is left byte-for-byte untouched so
// its own already-verified behaviour can't be affected by this addition.
//
// Declination/equation-of-time are computed once, referenced at UTC
// noon of that day (gamma's own hourUTC term barely moves either value
// across a single day - this matches NOAA's own reference spreadsheet,
// which uses one declination/eqTime pair per day rather than
// recomputing per-instant for a sunrise/sunset calculation).
//
// Same "geometric horizon" (cosZenith = 0) convention as isDaytimeAt,
// not the ~90.833 deg civil-sunrise/sunset refraction adjustment - kept
// consistent with the rest of this file rather than introducing a
// second, slightly different definition of "sunrise" within the same
// module.
export function sunriseSunsetAt(dateUtcMs: number, latitudeDeg: number, longitudeDeg: number): { sunrise: number; sunset: number } {
  const date = new Date(dateUtcMs);
  const startOfYearUTC = Date.UTC(date.getUTCFullYear(), 0, 1);
  const startOfDayUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((startOfDayUTC - startOfYearUTC) / 86400000) + 1;
  const hourUTC = 12; // noon reference for the day's declination/eqTime, per NOAA's own convention

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUTC - 12) / 24);

  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const latRad = (latitudeDeg * Math.PI) / 180;

  // cosZenith = sin(lat)sin(decl) + cos(lat)cos(decl)cos(hourAngle) = 0
  // => cos(hourAngle) = -tan(lat)tan(decl). Clamped to [-1, 1] rather
  // than left to produce NaN - at latitudes/dates with permanent
  // polar day or night this argument falls outside acos's domain, and
  // clamping degrades to "sun at its highest/lowest point all day"
  // (a full 12h from solar noon) rather than crashing. Not a scenario
  // this app's real tenants (all UK-based) will ever actually hit, but
  // a graceful fallback costs nothing.
  const cosHourAngle = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(declRad)));
  const hourAngleDeg = (Math.acos(cosHourAngle) * 180) / Math.PI;
  const hourAngleMin = hourAngleDeg * 4; // 1 degree of hour angle = 4 minutes of time

  const timeOffsetMin = eqTimeMin + 4 * longitudeDeg;
  const solarNoonUTCmin = 720 - timeOffsetMin;

  const sunrise = startOfDayUTC + (solarNoonUTCmin - hourAngleMin) * 60000;
  const sunset = startOfDayUTC + (solarNoonUTCmin + hourAngleMin) * 60000;

  return { sunrise, sunset };
}
