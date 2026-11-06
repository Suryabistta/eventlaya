import type { Event, EventPhase } from '@/services/api'

export type { EventPhase }

type PhaseFields = Pick<Event, 'status' | 'start_date' | 'start_time' | 'end_date' | 'end_time'> & { phase?: EventPhase }

const localDate = (d: string, t?: string | null) => new Date(`${d}T${t || '00:00:00'}`)

/** The event's lifecycle phase: from the API when present, else guessed from status and dates. */
export function eventPhase(e: PhaseFields): EventPhase {
  if (e.phase) return e.phase
  if (e.status === 'cancelled') return 'cancelled'
  if (e.status === 'draft') return 'draft'
  if (e.status === 'completed') return 'ended'
  if (e.status === 'ongoing') return 'live'
  const now = new Date()
  const end = localDate(e.end_date || e.start_date, e.end_time || '23:59:59')
  if (end < now) return 'ended'
  const start = localDate(e.start_date, e.start_time)
  return start <= now ? 'live' : 'upcoming'
}

export const phaseMeta: Record<EventPhase, { label: string; tone: 'neutral' | 'success' | 'brand' | 'danger' | 'info' | 'warning'; dot: string }> = {
  draft: { label: 'Draft', tone: 'neutral', dot: 'bg-ink-300' },
  upcoming: { label: 'Upcoming', tone: 'info', dot: 'bg-sky-500' },
  live: { label: 'Happening now', tone: 'success', dot: 'bg-emerald-500' },
  ended: { label: 'Ended', tone: 'neutral', dot: 'bg-ink-400' },
  cancelled: { label: 'Cancelled', tone: 'danger', dot: 'bg-red-500' },
}

/** Whole days from today until the event starts (0 = today), by local calendar day. */
export function daysUntil(e: Pick<Event, 'start_date'>) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((localDate(e.start_date).getTime() - today.getTime()) / 86_400_000)
}

/** "Starts today", "Starts tomorrow", "Starts in 3 days", "Starts in 5 weeks". */
export function startsInText(e: Pick<Event, 'start_date'>) {
  const d = daysUntil(e)
  if (d <= 0) return 'Starts today'
  if (d === 1) return 'Starts tomorrow'
  if (d < 21) return `Starts in ${d} days`
  if (d < 70) return `Starts in ${Math.round(d / 7)} weeks`
  return `Starts in ${Math.round(d / 30)} months`
}

/** Pick a sensible default event: live, else the next upcoming, else the most recent. */
export function defaultEvent<T extends PhaseFields>(events: T[]): T | undefined {
  if (!events.length) return undefined
  const live = events.filter((e) => eventPhase(e) === 'live')
  if (live.length) return live.sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
  const upcoming = events.filter((e) => eventPhase(e) === 'upcoming').sort((a, b) => a.start_date.localeCompare(b.start_date))
  if (upcoming.length) return upcoming[0]
  return [...events].sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
}

/** Sort order for organizer lists: live, upcoming (soonest first), drafts, then ended/cancelled (most recent first). */
export function sortByPhase<T extends PhaseFields>(events: T[]): T[] {
  const rank: Record<EventPhase, number> = { live: 0, upcoming: 1, draft: 2, ended: 3, cancelled: 3 }
  return [...events].sort((a, b) => {
    const ra = rank[eventPhase(a)]
    const rb = rank[eventPhase(b)]
    if (ra !== rb) return ra - rb
    return ra >= 3 ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date)
  })
}
