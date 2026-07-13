// Standard aviation approximation: cloud base (ft AGL) = 400 x (temp_c - dewpoint_c).
// A genuine estimate from a real station's temp/dewpoint spread, not a
// measured ceiling - callers are responsible for labelling it as such.
export function estimateCloudBaseFt(temperatureC: number, dewpointC: number): number {
  return Math.round(400 * (temperatureC - dewpointC))
}
