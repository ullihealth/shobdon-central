export interface WindComponents {
  headwind: number
  crosswind: number
}

export type ArrowColour = 'green' | 'amber' | 'red'

const CARDINAL_POINTS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
]

export function calculateWindComponents(
  windSpeed: number,
  windDirection: number,
  runwayHeading: number
): WindComponents {
  const windRadians = (windDirection * Math.PI) / 180
  const runwayRadians = (runwayHeading * Math.PI) / 180

  const headwind = windSpeed * Math.cos(windRadians - runwayRadians)
  const crosswind = windSpeed * Math.sin(windRadians - runwayRadians)

  return { headwind, crosswind }
}

export function determineArrowColour(headwind: number, crosswind: number): ArrowColour {
  const absCrosswind = Math.abs(crosswind)

  if (headwind < -2) {
    return 'red'
  }

  if (absCrosswind > 5) {
    return 'amber'
  }

  if (headwind < 3 && headwind >= -2) {
    return 'amber'
  }

  return 'green'
}

export function degreesToCardinal(degrees: number): string {
  const normalised = ((degrees % 360) + 360) % 360
  const index = Math.round(normalised / 22.5) % 16
  return CARDINAL_POINTS[index]
}
