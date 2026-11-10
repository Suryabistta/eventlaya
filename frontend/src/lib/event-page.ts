import { useQuery } from '@tanstack/react-query'
import { formatDate } from './dates'
import { request, type DynamicForm, type Event, type Ticket } from '@/services/api'
import { eventPriceLabel } from '@/lib/tickets'
import { eventPhase, type EventPhase } from '@/lib/phase'

/** Slug of an event type managed by the superadmin (Admin → Cities & categories → Event types). */
export type EventCategory = string

export interface EventCategoryItem {
  id: string
  name: string
  slug: string
  order: number
  is_active: boolean
  /** Superadmin list only: events using it (blocks delete) */
  events_count?: number | null
}

// Shown until the list loads, or if it fails; matches the types seeded on the server
const FALLBACK_CATEGORIES = ['Conference', 'Hackathon', 'Concert', 'Festival', 'Workshop', 'Sports', 'Wedding', 'Meetup'].map((name, order) => ({
  id: name,
  name,
  slug: name.toLowerCase(),
  order,
  is_active: true,
}))

/** Active event types, in the superadmin's order. */
export function useEventCategories(): EventCategoryItem[] {
  const { data } = useQuery({
    queryKey: ['event-categories'],
    queryFn: () => request<EventCategoryItem[]>('/platform/event-categories/'),
    staleTime: 10 * 60_000,
  })
  return data?.length ? data : FALLBACK_CATEGORIES
}

export interface AgendaItem {
  id?: string
  day: string | null
  start_time: string
  end_time: string | null
  title: string
  description: string
  location: string
  speaker_names: string
  order?: number
}

export interface Speaker {
  id?: string
  name: string
  role: string
  organization: string
  photo_url: string
  bio: string
  order?: number
}

export interface Faq {
  id?: string
  question: string
  answer: string
  order?: number
}

export interface EventPageContent {
  tagline: string
  category: EventCategory
  highlights: string[]
  contact_email: string
  contact_phone: string
  map_query: string
  terms?: string
  /** Heading of the speakers section ('' = Speakers) */
  speakers_label?: string
  agenda: AgendaItem[]
  speakers: Speaker[]
  faqs: Faq[]
}

export interface SubEventCard {
  id: string
  title: string
  slug: string
  tagline: string
  start_date: string
  start_time: string | null
  end_date: string | null
  end_time: string | null
  location: string
  phase: string
  registration_open: boolean
  registration_closed_reason: string | null
  allow_registration: boolean
}

export type PublicEvent = Event &
  EventPageContent & {
    organizer_name?: string
    banner_absolute: string | null
    spots_left: number | null
    organizer_info: { name: string; logo: string | null; verified?: boolean }
    /** Only present when the organizer switched "Managed by" on */
    managed_by_info?: { name: string; logo: string | null; label?: string } | null
    /** Applications stage (null when off) */
    applications?: PublicApplications | null
    /** Timeline when the event has more than one stage (applications → voting → tickets) */
    stages?: EventStage[]
    /** Published sub-events of a main event (module sub_events), soonest first */
    sub_events?: SubEventCard[]
    /** The main event, when this is a sub-event */
    parent?: { id: string; title: string; slug: string } | null
    /** How attendees can pay (online via Khalti/eSewa and/or at the venue) */
    payment_options?: import('@/lib/payments').PaymentOptions
  }

export const eventPageApi = {
  get: (eventId: string) => request<EventPageContent & { slug: string; title: string }>(`/events/${eventId}/page/`),
  put: (eventId: string, body: Partial<EventPageContent>) =>
    request<EventPageContent>(`/events/${eventId}/page/`, { method: 'PUT', body: JSON.stringify(body) }),
  publicDetail: (slug: string) => request<{ event: PublicEvent; form: DynamicForm | null }>(`/events/public/${slug}/`),
}

/* ---------- dates ---------- */

export const toDate = (d: string, t?: string | null) => new Date(`${d}T${t || '00:00:00'}`)
// BS by default (lib/dates); AD when the viewer prefers it
export const fmtDay = (d: Date, withYear = true) => formatDate(d, 'full', withYear)
export const fmtShortDay = (d: Date) => formatDate(d, 'weekday', false)
export const fmtClock = (t: string | Date) => {
  const d = typeof t === 'string' ? toDate('2000-01-01', t) : t
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function eventWhen(e: Pick<Event, 'start_date' | 'start_time' | 'end_date' | 'end_time'>) {
  const start = toDate(e.start_date, e.start_time)
  const startLabel = `${fmtDay(start)}${e.start_time ? `, ${fmtClock(start)}` : ''}`
  let endLabel: string | null = null
  if (e.end_date && e.end_date !== e.start_date) {
    const end = toDate(e.end_date, e.end_time)
    endLabel = `Until ${fmtDay(end, false)}${e.end_time ? `, ${fmtClock(end)}` : ''}`
  } else if (e.end_time) {
    endLabel = `Until ${fmtClock(e.end_time)}`
  }
  const shortDate = formatDate(start, 'weekday') + (e.start_time ? `, ${fmtClock(start)}` : '')
  // "27 to 28 Kartik 2083" style range for compact headers
  let range = fmtDay(start)
  if (e.end_date && e.end_date !== e.start_date) {
    const end = toDate(e.end_date)
    range = `${formatDate(start, 'long', false)} to ${formatDate(end, 'long')}`
  }
  return { startLabel, endLabel, shortDate, range }
}

/**
 * Spots for attendees. When the organizer hides the numbers the server blanks them (capacity 0),
 * so `hidden` must be checked before treating capacity 0 as "no limit".
 */
export function spotsInfo(e: Pick<PublicEvent, 'capacity' | 'registered_count' | 'spots_hidden' | 'is_full'> & { spots_left?: number | null }) {
  const hidden = Boolean(e.spots_hidden)
  const capacity = !hidden && e.capacity > 0 ? e.capacity : null
  const left = capacity === null ? null : (e.spots_left ?? Math.max(0, capacity - e.registered_count))
  const full = e.is_full ?? left === 0
  return { hidden, capacity, left, full, limited: hidden || capacity !== null }
}

/** Status of registration for an event, with a reason to show when it's closed. Prefers the server's phase/registration_open. */
export function registrationState(e: PublicEvent): { open: boolean; reason?: string; label?: string; phase: EventPhase } {
  const phase = eventPhase(e)
  if (phase === 'cancelled') return { open: false, phase, label: 'Event cancelled', reason: e.registration_closed_reason || 'The organizer cancelled this event.' }
  if (phase === 'ended') return { open: false, phase, label: 'Event has ended', reason: e.registration_closed_reason || 'This event has already happened.' }
  if (e.is_full) return { open: false, phase, label: 'Fully booked', reason: e.registration_closed_reason || 'Every spot has been taken.' }
  if (e.registration_open !== undefined) {
    if (e.registration_open) return { open: true, phase }
    const reason = e.registration_closed_reason || 'Registration is closed.'
    const full = /full|capacity|sold out|spots/i.test(reason)
    return { open: false, phase, label: full ? 'Fully booked' : 'Bookings closed', reason }
  }
  // Older API without registration_open: guess from the event fields
  if (phase === 'draft') return { open: false, phase, label: 'Not published', reason: 'The organizer hasn’t published this event yet.' }
  if (!e.allow_registration) return { open: false, phase, label: 'Bookings closed', reason: 'The organizer has closed registration.' }
  if (e.registration_deadline && new Date(e.registration_deadline) < new Date())
    return { open: false, phase, label: 'Bookings closed', reason: 'The registration deadline has passed.' }
  if (e.capacity > 0 && (e.spots_left ?? e.capacity - e.registered_count) <= 0) return { open: false, phase, label: 'Fully booked', reason: 'Every spot has been taken.' }
  return { open: true, phase }
}

/** "Free", "Rs 500", or "From Rs 250" when the event has several ticket prices. */
export const priceLabel = (e: Pick<Event, 'is_paid' | 'ticket_price' | 'ticket_types' | 'registration_mode' | 'tickets_enabled' | 'applications_enabled'>) =>
  callOnly(e) ? 'Free · Open call' : e.registration_mode === 'form' ? 'Free · Registration' : eventPriceLabel(e.ticket_types, e)

/** True when anyone has to pay at the venue for some ticket. */
export const hasPaidTickets = (e: Pick<Event, 'is_paid' | 'ticket_price' | 'ticket_types'>) =>
  e.ticket_types?.length ? e.ticket_types.some((t) => Number(t.price) > 0) : e.is_paid && Number(e.ticket_price) > 0

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

/* ---------- calendar, share, stored pass ---------- */

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
const icsLocal = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`
}
const icsDate = (d: string) => d.replace(/-/g, '')

/** Builds and downloads an .ics file for the event (client-side, no server call). */
export function downloadIcs(e: Pick<Event, 'title' | 'slug' | 'location' | 'description' | 'start_date' | 'start_time' | 'end_date' | 'end_time'>, ticket?: Ticket) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Eventlaya//Event page//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT']
  lines.push(`UID:${ticket?.id ?? e.slug}@eventlaya`)
  lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`)
  if (e.start_time) {
    const start = toDate(e.start_date, e.start_time)
    const end = e.end_time ? toDate(e.end_date || e.start_date, e.end_time) : new Date(start.getTime() + 2 * 3600 * 1000)
    lines.push(`DTSTART:${icsLocal(start)}`, `DTEND:${icsLocal(end)}`)
  } else {
    const endDay = new Date(toDate(e.end_date || e.start_date).getTime() + 24 * 3600 * 1000)
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start_date)}`, `DTEND;VALUE=DATE:${icsDate(endDay.toISOString().slice(0, 10))}`)
  }
  lines.push(`SUMMARY:${icsEscape(e.title)}`, `LOCATION:${icsEscape(e.location)}`)
  const url = `${window.location.origin}/e/${e.slug}`
  const desc = [ticket ? `Your ticket: ${ticket.ticket_number}. Show your QR pass at the gate.` : '', url].filter(Boolean).join('\n')
  lines.push(`DESCRIPTION:${icsEscape(desc)}`, `URL:${url}`, 'END:VEVENT', 'END:VCALENDAR')
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${e.slug}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Native share sheet when available, else copy to clipboard. Returns what happened. */
export async function shareOrCopy(data: { title: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(data.text ? `${data.text}\n${data.url}` : data.url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

const passKey = (slug: string) => `eventlaya:pass:${slug}`
const passesKey = (slug: string) => `eventlaya:passes:${slug}`

/** The buyer's own pass saved on this device (the first of their passes). */
export function getStoredPass(slug: string): Ticket | null {
  return getStoredPasses(slug)[0] ?? null
}

/** Every pass saved on this device for this event: the buyer's first, then their guests'. */
export function getStoredPasses(slug: string): Ticket[] {
  try {
    const many = localStorage.getItem(passesKey(slug))
    if (many) {
      const list = JSON.parse(many) as Ticket[]
      if (Array.isArray(list) && list.length) return list
    }
    // Older devices saved one pass under the single key
    const raw = localStorage.getItem(passKey(slug))
    return raw ? [JSON.parse(raw) as Ticket] : []
  } catch {
    return []
  }
}

export function storePass(slug: string, ticket: Ticket | null) {
  storePasses(slug, ticket ? [ticket] : [])
}

/** Saves passes for "View my pass". The first also goes under the older single-pass key. */
export function storePasses(slug: string, tickets: Ticket[]) {
  try {
    if (tickets.length) {
      localStorage.setItem(passKey(slug), JSON.stringify(tickets[0]))
      localStorage.setItem(passesKey(slug), JSON.stringify(tickets))
    } else {
      localStorage.removeItem(passKey(slug))
      localStorage.removeItem(passesKey(slug))
    }
  } catch {
    /* storage unavailable */
  }
}

/** Oldest order first; within an order the buyer's pass, then guests in order. */
export const sortPasses = <T extends Pick<Ticket, 'guest_number' | 'created_at' | 'order_reference'>>(list: T[]) =>
  [...list].sort((a, b) =>
    a.order_reference && a.order_reference === b.order_reference
      ? (a.guest_number ?? 0) - (b.guest_number ?? 0)
      : a.created_at.localeCompare(b.created_at) || (a.guest_number ?? 0) - (b.guest_number ?? 0),
  )

export interface PublicPass {
  ticket: Ticket
  event: Pick<Event, 'id' | 'title' | 'slug' | 'location' | 'start_date'> & {
    start_time?: string | null
    end_date?: string | null
    end_time?: string | null
    banner?: string | null
    phase?: EventPhase
  }
}

/** Public: one pass by its QR token (the link in the confirmation email). */
export const getPublicPass = (token: string) => request<PublicPass>(`/events/passes/${encodeURIComponent(token)}/`)

/** Call to action on an event: "Register" for registration-only events, "Get tickets" when any ticket costs money, otherwise "Book a spot". */
export const bookLabel = (
  e: Pick<Event, 'is_paid' | 'ticket_price' | 'ticket_types' | 'registration_mode' | 'cta_label' | 'tickets_enabled' | 'applications_enabled' | 'application_cta'>,
) =>
  callOnly(e) ? e.application_cta?.trim() || 'Apply' : e.cta_label?.trim() ? e.cta_label.trim() : e.registration_mode === 'form' ? 'Register' : hasPaidTickets(e) ? 'Get tickets' : 'Book a spot'

/** Applications stage on, tickets / registration off: the event is (for now) only an open call. */
export const callOnly = (e: Pick<Event, 'tickets_enabled' | 'applications_enabled'>) => Boolean(e.applications_enabled) && e.tickets_enabled === false

/** Applications still open, from the list data (the detail page gets `applications.open` from the server). */
export const applicationsOpen = (e: Pick<Event, 'applications_enabled' | 'applications_close'>) =>
  Boolean(e.applications_enabled && e.applications_close && new Date(e.applications_close).getTime() > Date.now())

/** The applications stage as the public event page sees it (apps.events PublicEventDetailView). */
export interface PublicApplications {
  open: boolean
  closed_reason: string | null
  closes_at: string | null
  cta: string
  form: import('@/services/api').DynamicForm | null
}

/** One stage of the event's timeline (apps.events.views.event_stages). */
export interface EventStage {
  kind: 'applications' | 'voting' | 'tickets'
  title: string
  cta: string | null
  state: 'upcoming' | 'open' | 'closed'
  opens_at: string | null
  closes_at: string | null
  date?: string | null
  href: string
}
