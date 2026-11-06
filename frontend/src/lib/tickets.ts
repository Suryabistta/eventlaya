import { request } from '@/services/api'

export type Availability = 'on_sale' | 'not_started' | 'ended' | 'sold_out' | 'inactive'

export interface TicketType {
  id: string
  name: string
  description: string
  /** Decimal string, e.g. "500.00" */
  price: string
  quantity: number | null
  sales_start: string | null
  sales_end: string | null
  gate_note: string
  is_hidden: boolean
  is_active: boolean
  allowed_gates: string[]
  allowed_gate_names: string[]
  order: number
  sold: number
  remaining: number | null
  availability: Availability
  /** Must be paid online (no pay at the venue) */
  online_only?: boolean
}

export interface TicketTypeInput {
  name: string
  description?: string
  price: string | number
  quantity?: number | null
  sales_start?: string | null
  sales_end?: string | null
  gate_note?: string
  is_hidden?: boolean
  is_active?: boolean
  allowed_gates?: string[]
  order?: number
  online_only?: boolean
}

export type DiscountType = 'percent' | 'amount' | 'none'

export interface PromoCode {
  id: string
  code: string
  discount_type: DiscountType
  discount_value: string
  /** Empty means every ticket type */
  ticket_types: string[]
  max_uses: number | null
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  used: number
  created_at: string
}

export type PromoCodeInput = Partial<Omit<PromoCode, 'id' | 'used' | 'created_at'>>

/** What attendees see on the event page. */
export interface PublicTicketType {
  id: string
  name: string
  description: string
  price: string
  remaining: number | null
  sales_start: string | null
  sales_end: string | null
  availability: Availability
  note: string
  online_only?: boolean
}

export type PromoTicketType = PublicTicketType & { discounted_price: string; promo_applies: boolean; unlocked: boolean }

export interface PromoCheck {
  valid: true
  code: string
  label: string
  ticket_types: PromoTicketType[]
}

export type PresetId = 'free' | 'general' | 'early_bird' | 'student' | 'vip' | 'full'

export const ticketKeys = {
  types: (eventId: string) => ['ticketTypes', eventId] as const,
  promos: (eventId: string) => ['promoCodes', eventId] as const,
}

export const ticketsApi = {
  list: (eventId: string) => request<TicketType[]>(`/events/${eventId}/ticket-types/`),
  create: (eventId: string, body: TicketTypeInput) =>
    request<TicketType>(`/events/${eventId}/ticket-types/`, { method: 'POST', body: JSON.stringify(body) }),
  update: (eventId: string, typeId: string, body: Partial<TicketTypeInput>) =>
    request<TicketType>(`/events/${eventId}/ticket-types/${typeId}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (eventId: string, typeId: string) =>
    request<{ deleted: boolean; deactivated: boolean; message: string }>(`/events/${eventId}/ticket-types/${typeId}/`, { method: 'DELETE' }),
  applyPreset: (eventId: string, preset: PresetId, base_price?: number) =>
    request<{ ticket_types: TicketType[]; kept_inactive: string[] }>(`/events/${eventId}/ticket-types/preset/`, {
      method: 'POST',
      body: JSON.stringify({ preset, base_price }),
    }),

  promos: (eventId: string) => request<PromoCode[]>(`/events/${eventId}/promo-codes/`),
  createPromo: (eventId: string, body: PromoCodeInput) =>
    request<PromoCode>(`/events/${eventId}/promo-codes/`, { method: 'POST', body: JSON.stringify(body) }),
  updatePromo: (eventId: string, codeId: string, body: PromoCodeInput) =>
    request<PromoCode>(`/events/${eventId}/promo-codes/${codeId}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  removePromo: (eventId: string, codeId: string) =>
    request<{ deleted: boolean; deactivated: boolean; message: string }>(`/events/${eventId}/promo-codes/${codeId}/`, { method: 'DELETE' }),

  /** Public: check a promo code on the registration page. Throws with the server's error on an invalid code. */
  checkPromo: (slug: string, code: string) => request<PromoCheck>(`/events/public/${slug}/promo/`, { method: 'POST', body: JSON.stringify({ code }) }),
}

/** Splits an error from `request` ("field: message") back into a field map. */
export function fieldErrorsOf(err: unknown, known: string[]): { fields: Record<string, string>; message: string } {
  const message = err instanceof Error ? err.message : 'Something went wrong. Try again.'
  const m = /^([a-z_]+): (.*)$/s.exec(message)
  if (m && known.includes(m[1])) return { fields: { [m[1]]: m[2] }, message: m[2] }
  if (m && m[1] === 'non_field_errors') return { fields: {}, message: m[2] }
  return { fields: {}, message }
}

/* ---------- formatting ---------- */

export const money = (v: string | number) => {
  const n = Number(v)
  return Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "Free" or "Rs 500" */
export const priceText = (v: string | number) => (Number(v) > 0 ? `Rs ${money(v)}` : 'Free')

export const fmtShortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })

/** Short reason a ticket type can't be bought right now (or null when it can). */
export function availabilityText(t: Pick<PublicTicketType, 'availability' | 'sales_start' | 'sales_end'>): string | null {
  switch (t.availability) {
    case 'on_sale':
      return null
    case 'not_started':
      return t.sales_start ? `On sale from ${fmtDateTime(t.sales_start)}` : 'Not on sale yet'
    case 'ended':
      return 'Sales ended'
    case 'sold_out':
      return 'Sold out'
    default:
      return 'Not available'
  }
}

/**
 * Price label for an event, from its public ticket types when present:
 * "Free", "Rs 500", or "From Rs 250" when prices differ.
 */
export function eventPriceLabel(types: Pick<PublicTicketType, 'price' | 'availability'>[] | undefined, fallback: { is_paid: boolean; ticket_price: string }) {
  if (!types || types.length === 0) return fallback.is_paid && Number(fallback.ticket_price) > 0 ? `Rs ${money(fallback.ticket_price)}` : 'Free'
  const open = types.filter((t) => t.availability === 'on_sale' || t.availability === 'not_started')
  const list = open.length ? open : types
  const prices = list.map((t) => Number(t.price))
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  if (max <= 0) return 'Free'
  if (min === max) return `Rs ${money(min)}`
  return min <= 0 ? `Free to Rs ${money(max)}` : `From Rs ${money(min)}`
}

/* ---------- presets (mirrors backend/apps/events/ticketing.py) ---------- */

export interface PresetRow {
  name: string
  factor: number
  note?: string
}

export const PRESETS: { id: PresetId; title: string; description: string; rows: PresetRow[] }[] = [
  { id: 'free', title: 'Free event', description: 'One free ticket. Nobody pays.', rows: [{ name: 'Free entry', factor: 0 }] },
  { id: 'general', title: 'Single price', description: 'One ticket, one price for everyone.', rows: [{ name: 'General', factor: 1 }] },
  {
    id: 'early_bird',
    title: 'Early bird + General',
    description: 'First 50 get 20% off until a week before.',
    rows: [
      { name: 'Early Bird', factor: 0.8, note: '50 tickets, sales end 7 days before' },
      { name: 'General', factor: 1 },
    ],
  },
  {
    id: 'student',
    title: 'Student + General',
    description: 'Half price for students with ID.',
    rows: [
      { name: 'Student', factor: 0.5, note: 'Gate staff check student ID' },
      { name: 'General', factor: 1 },
    ],
  },
  {
    id: 'vip',
    title: 'General + VIP',
    description: 'VIP at double price, entry through VIP gates.',
    rows: [
      { name: 'General', factor: 1 },
      { name: 'VIP', factor: 2, note: 'Only at your VIP gates' },
    ],
  },
  {
    id: 'full',
    title: 'Everything',
    description: 'Early bird, student, general and VIP.',
    rows: [
      { name: 'Early Bird', factor: 0.8, note: '50 tickets, sales end 7 days before' },
      { name: 'Student', factor: 0.5, note: 'Gate staff check student ID' },
      { name: 'General', factor: 1 },
      { name: 'VIP', factor: 2, note: 'Only at your VIP gates' },
    ],
  },
]

/** Same rounding as the server (2 decimals, half up). */
export const presetPrice = (base: number, factor: number) => Math.round(base * factor * 100) / 100

/** Readable promo summary, e.g. "10% off · General, Student". */
export function promoLabel(p: Pick<PromoCode, 'discount_type' | 'discount_value' | 'ticket_types'>, types: Pick<TicketType, 'id' | 'name'>[]) {
  const v = Number(p.discount_value)
  const what = p.discount_type === 'percent' ? `${money(v)}% off` : p.discount_type === 'amount' ? `Rs ${money(v)} off` : 'Unlocks tickets'
  const names = p.ticket_types.map((id) => types.find((t) => t.id === id)?.name).filter(Boolean)
  return `${what} · ${names.length ? names.join(', ') : 'All tickets'}`
}

/** A readable random code like "EVT-7K3Q". */
export function generateCode(prefix = 'EVT') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  const rand = new Uint32Array(6)
  crypto.getRandomValues(rand)
  for (const r of rand) s += chars[r % chars.length]
  return `${prefix.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase() || 'EVT'}-${s}`
}
