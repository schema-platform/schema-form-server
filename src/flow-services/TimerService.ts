/**
 * Parse ISO 8601 timer values and compute a fire date.
 *
 * Supported formats:
 *   duration — PT30M, PT1H, P1D, P1DT12H, PT1H30M, etc.
 *   date     — 2026-06-01T10:00:00Z (any ISO-8601 datetime)
 *   cycle    — treated as duration for now (fire once after delay)
 */

export function parseTimerValue(type: string, value: string): Date {
  const now = new Date()

  switch (type) {
    case 'duration':
    case 'cycle': {
      const ms = parseIso8601Duration(value)
      return new Date(now.getTime() + ms)
    }
    case 'date': {
      const d = new Date(value)
      if (isNaN(d.getTime())) {
        throw new Error(`Invalid ISO 8601 date: ${value}`)
      }
      return d
    }
    default:
      throw new Error(`Unknown timer type: ${type}`)
  }
}

/**
 * Parse an ISO 8601 duration string into milliseconds.
 * Handles: PnYnMnDTnHnMnS (only the parts present are required).
 *
 * Examples:
 *   PT30M   → 1 800 000
 *   PT1H    → 3 600 000
 *   P1D     → 86 400 000
 *   P1DT12H → 129 600 000
 *   PT1H30M → 5 400 000
 */
export function parseIso8601Duration(value: string): number {
  const match = value.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\d+)?)S)?)?$/,
  )
  if (!match) {
    throw new Error(`Invalid ISO 8601 duration: ${value}`)
  }

  const years = Number(match[1] ?? 0)
  const months = Number(match[2] ?? 0)
  const days = Number(match[3] ?? 0)
  const hours = Number(match[4] ?? 0)
  const minutes = Number(match[5] ?? 0)
  const seconds = Number(match[6] ?? 0)

  if (years === 0 && months === 0 && days === 0 && hours === 0 && minutes === 0 && seconds === 0) {
    throw new Error(`ISO 8601 duration must have at least one non-zero component: ${value}`)
  }

  // Approximate: 1 year = 365 days, 1 month = 30 days
  const totalDays = years * 365 + months * 30 + days
  const totalSeconds = totalDays * 86400 + hours * 3600 + minutes * 60 + seconds
  return totalSeconds * 1000
}
