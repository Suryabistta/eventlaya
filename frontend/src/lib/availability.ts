import { ApiError, request } from '@/services/api'
import { BS_MONTHS, calendarSystem, toBs } from './calendar'

/**
 * Vendor availability slots and booking requests (marketplace module).
 * API contract: docs/api/vendor-bookings.md. Dates are YYYY-MM-DD, times HH:MM (Asia/Kathmandu).
 */

const json = (body: unknown) => JSON.stringify(body)

export type SlotStatus = 'open' | 'held' | 'booked' | 'blocked'
export type ListingKind = 'venue' | 'vendor'
export type RequestStatus = 'pending' | 'contacted' | 'booked' | 'rejected' | 'cancelled'

/** The booking request holding a held / booked slot (owner view only). */
export interface SlotRequest {
  id: string
  kind: ListingKind
  status: RequestStatus
  sender_name: string
  sender_email: string
  sender_phone: string
  event_type: string
  guest_count: number | null
  budget_range: string
  message: string
  owner_note: string
  created_at: string
}

/** Owner view of a slot. */
export interface Slot {
  id: string
  kind: ListingKind
  venue: string | null
  vendor: string | null
  listing_name: string
  space: string | null
  space_name: string | null
  date: string
  start_time: string | null
  end_time: string | null
  is_full_day: boolean
  price: string | null
  effective_price: string | null
  note: string
  status: SlotStatus
  request: SlotRequest | null
  created_at: string
  updated_at: string
}

/** Public calendar entry: no customer details; price and note only on open slots. */
export interface PublicSlot {
  id: string
  date: string
  start_time: string | null
  end_time: string | null
  is_full_day: boolean
  space: string | null
  space_name: string | null
  price: string | null
  note: string
  status: SlotStatus
  available: boolean
}

/** The slot attached to an inquiry (owner inbox and the customer's My inquiries). */
export interface InquirySlot {
  id: string
  date: string
  start_time: string | null
  end_time: string | null
  is_full_day: boolean
  space_id: string | null
  space_name: string | null
  price: string | null
  status: SlotStatus
}

export interface SlotTarget {
  venue?: string
  vendor?: string
  space?: string | null
}

export interface SlotInput {
  date: string
  start_time: string | null
  end_time: string | null
  price: string | null
  note: string
  status?: 'open' | 'blocked'
}

export interface BulkInput {
  start_date: string
  end_date: string
  /** 0 = Monday … 6 = Sunday */
  weekdays: number[]
  start_time: string | null
  end_time: string | null
  price: string | null
  note: string
}

export interface BulkResult {
  created: number
  skipped: number
  skipped_dates: string[]
  slots: Slot[]
}

export interface BlockResult {
  created: number
  blocked: number
  skipped: { date: string; slot_id: string; reason: string }[]
  slots: Slot[]
}

interface SlotList<T> {
  from: string
  to: string
  count: number
  results: T[]
}

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, String(v === true ? 1 : v))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** `{venue}` or `{vendor}` plus the optional space, without empty keys. */
const target = (t: SlotTarget) => ({
  ...(t.venue ? { venue: t.venue } : { vendor: t.vendor }),
  ...(t.venue && t.space ? { space: t.space } : {}),
})

export const slotsApi = {
  /* Owner */
  list: (t: SlotTarget & { from: string; to: string; status?: string }) =>
    request<SlotList<Slot>>(`/marketplace/my/slots/${qs({ ...target(t), from: t.from, to: t.to, status: t.status })}`),
  create: (t: SlotTarget, body: SlotInput) =>
    request<Slot>('/marketplace/my/slots/', { method: 'POST', body: json({ ...target(t), ...body }) }),
  update: (id: string, body: Partial<SlotInput>) =>
    request<Slot>(`/marketplace/my/slots/${id}/`, { method: 'PATCH', body: json(body) }),
  remove: (id: string) => request<null>(`/marketplace/my/slots/${id}/`, { method: 'DELETE' }),
  bulk: (t: SlotTarget, body: BulkInput) =>
    request<BulkResult>('/marketplace/my/slots/bulk/', { method: 'POST', body: json({ ...target(t), ...body }) }),
  block: (t: SlotTarget, dates: string[], note = '') =>
    request<BlockResult>('/marketplace/my/slots/block/', { method: 'POST', body: json({ ...target(t), dates, note }) }),

  /** Owner decision on a venue / vendor inquiry (with or without a slot). */
  decide: <T = unknown>(kind: ListingKind, id: string, decision: 'confirm' | 'decline', note?: string) =>
    request<T>(`/marketplace/my/${kind === 'venue' ? 'inquiries' : 'vendor-inquiries'}/${id}/${decision}/`, {
      method: 'POST',
      body: json(note ? { note } : {}),
    }),

  /* Public */
  publicList: (kind: ListingKind, id: string, params: { from?: string; to?: string; space?: string; includeUnavailable?: boolean } = {}) =>
    request<SlotList<PublicSlot>>(
      `/marketplace/${kind === 'venue' ? 'venues' : 'vendors'}/${id}/availability/${qs({
        from: params.from,
        to: params.to,
        space: params.space,
        include_unavailable: params.includeUnavailable,
      })}`,
    ),

  /** Customer: request a slot. Date and space come from the slot. */
  requestSlot: <T = { id: string }>(kind: ListingKind, listingId: string, body: Record<string, unknown> & { slot_id: string }) =>
    request<T>(`/marketplace/${kind === 'venue' ? 'venues' : 'vendors'}/${listingId}/inquiries/`, { method: 'POST', body: json(body) }),

  /** Customer: withdraw a request (409 cannot_cancel when it is too late). */
  cancelMine: <T = unknown>(kind: ListingKind, id: string) => request<T>(`/me/inquiries/${kind}/${id}/cancel/`, { method: 'POST' }),
}

/* ------------------------------------------------------------------ Dates */

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD (not UTC, unlike toISOString). */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayIso = () => isoDate(new Date())
export const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (iso: string, n: number) => {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}
/** Monday-based weekday used by the API: 0 = Monday … 6 = Sunday (JS getDay() is 0 = Sunday). */
export const apiWeekday = (iso: string) => (parseIso(iso).getDay() + 6) % 7
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/**
 * AD: "Sat, 14 Nov" / "Saturday, 14 November 2026".
 * BS (the viewer's choice, see lib/calendar): "Sat, 28 Kartik" / "Saturday, 28 Kartik 2083 (14 Nov 2026)".
 */
export const fmtDay = (iso: string, long = false) => {
  const date = parseIso(iso)
  const bs = calendarSystem() === 'bs' ? toBs(date) : null
  if (!bs) {
    return date.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const weekday = date.toLocaleDateString('en-GB', { weekday: long ? 'long' : 'short' })
  const month = BS_MONTHS[bs.month]
  if (!long) return `${weekday}, ${bs.day} ${month}`
  return `${weekday}, ${bs.day} ${month} ${bs.year} (${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})`
}

/** "10:00" -> "10:00 AM" */
export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${pad(m)} ${suffix}`
}

/** "Full day" or "10:00 AM – 2:00 PM" */
export const slotTime = (s: { start_time: string | null; end_time: string | null }) =>
  s.start_time && s.end_time ? `${fmtTime(s.start_time)} – ${fmtTime(s.end_time)}` : 'Full day'

export const fmtPrice = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? null : `Rs ${Number(value).toLocaleString('en-IN')}`

/* ------------------------------------------------------------------ Display */

export const SLOT_STATUS: Record<SlotStatus, { label: string; chip: string; dot: string }> = {
  open: { label: 'Open', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  held: { label: 'Pending request', chip: 'bg-marigold-50 text-marigold-900 border-marigold-200', dot: 'bg-marigold-500' },
  booked: { label: 'Booked', chip: 'bg-brand-50 text-brand-800 border-brand-200', dot: 'bg-brand-600' },
  blocked: { label: 'Blocked', chip: 'bg-ink-100 text-ink-600 border-ink-200', dot: 'bg-ink-400' },
}

/** User-facing text for an API error, including DRF field errors like `{end_time: ["…"]}`. */
export function apiErrorText(err: unknown, fallback = 'Try again in a moment.') {
  if (err instanceof ApiError && err.data && typeof err.data === 'object') {
    const d = err.data as Record<string, unknown>
    if (typeof d.detail === 'string') return d.detail
    const nfe = d.non_field_errors
    if (Array.isArray(nfe) && typeof nfe[0] === 'string') return nfe[0]
    for (const [key, value] of Object.entries(d)) {
      if (Array.isArray(value) && typeof value[0] === 'string') {
        const field = key.replace(/_/g, ' ')
        return `${field.charAt(0).toUpperCase()}${field.slice(1)}: ${value[0]}`
      }
    }
  }
  return err instanceof Error && err.message ? err.message : fallback
}
