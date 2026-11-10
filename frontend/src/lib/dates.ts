import { BS_MONTHS, calendarSystem, toBs } from './calendar'

/**
 * One date formatter for the whole site: Bikram Sambat by default, AD when the viewer switched (lib/calendar,
 * CalendarToggle). Dates are still stored and sent as AD; only what people read changes.
 *
 *   short    "28 Kartik"                 / "14 Nov"
 *   medium   "28 Kartik 2083"            / "14 Nov 2026"
 *   long     "28 Kartik 2083"            / "14 November 2026"
 *   weekday  "Sat, 28 Kartik 2083"       / "Sat, 14 Nov 2026"
 *   full     "Saturday, 28 Kartik 2083"  / "Saturday, 14 November 2026"
 */
export type DateStyle = 'short' | 'medium' | 'long' | 'weekday' | 'full'

const AD: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
}

/** A date-only string ("2026-11-14") is a calendar day, not midnight UTC. */
export const asDate = (d: Date | string) => (typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00` : d) : d)

export function formatDate(value: Date | string | null | undefined, style: DateStyle = 'medium', withYear = true): string {
  if (!value) return ''
  const date = asDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const bs = calendarSystem() === 'bs' ? toBs(date) : null
  if (!bs) {
    const opts = { ...AD[style] }
    if (!withYear) delete opts.year
    return date.toLocaleDateString('en-GB', opts)
  }
  const main = `${bs.day} ${BS_MONTHS[bs.month]}${withYear && style !== 'short' ? ` ${bs.year}` : ''}`
  if (style === 'weekday') return `${date.toLocaleDateString('en-GB', { weekday: 'short' })}, ${main}`
  if (style === 'full') return `${date.toLocaleDateString('en-GB', { weekday: 'long' })}, ${main}`
  return main
}

/** "28 Kartik, 6:30 PM" (date and clock time). */
export const formatDateTime = (value: Date | string | null | undefined, style: DateStyle = 'short') => {
  if (!value) return ''
  const date = asDate(value)
  return `${formatDate(date, style)}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}
