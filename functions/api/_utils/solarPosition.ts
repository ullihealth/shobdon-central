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
