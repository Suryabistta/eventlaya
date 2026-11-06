import { request, tokenStore } from '@/services/api'

/** Online payments (backend: apps/payments, docs/payments.md). */

export type ProviderId = 'khalti' | 'esewa' | 'test'
export interface ProviderInfo {
  id: ProviderId
  name: string
  sandbox: boolean
}

/** What the registration page may offer (public event detail → payment_options). */
export interface PaymentOptions {
  mode: 'venue' | 'online' | 'both'
  online: boolean
  venue: boolean
  providers: ProviderInfo[]
  hold_minutes: number | null
}

export type OrderPaymentStatus = 'free' | 'due' | 'pending' | 'paid' | 'failed' | 'refunded'

/** How an order was / will be paid (on every pass and order). */
export interface PaymentInfo {
  method: 'venue' | 'online' | 'free'
  status: OrderPaymentStatus
  provider: string | null
  reference: string | null
  amount: string
  paid_at: string | null
  reserved_until: string | null
  /** e.g. "Paid online · Khalti · ref 4H7Ah…" or "Pay Rs 500 at the venue" */
  label: string
}

/** Either go to a page, or POST a signed form (eSewa). */
export type Checkout = { redirect_url: string; expires_at?: string } | { form_action: string; method: 'POST'; fields: Record<string, string> }

export type IntentStatus = 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refunded'

export interface PublicIntent<R = unknown> {
  id: string
  purpose: string
  reference: string
  description: string
  status: IntentStatus
  amount: string
  provider: ProviderId | null
  provider_name: string | null
  provider_txn_id: string | null
  created_at: string
  expires_at: string | null
  paid_at: string | null
  fulfilled: boolean
  failure_reason: string | null
  result: R | null
}

export const isOpenIntent = (s: IntentStatus) => s === 'created' || s === 'pending'

/** Send the browser to the provider. */
export function goToCheckout(checkout: Checkout) {
  if ('redirect_url' in checkout) {
    window.location.assign(checkout.redirect_url)
    return
  }
  const form = document.createElement('form')
  form.method = checkout.method || 'POST'
  form.action = checkout.form_action
  form.style.display = 'none'
  for (const [name, value] of Object.entries(checkout.fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

/** Short line for event pages. */
export function paymentNote(options?: PaymentOptions | null): string {
  if (!options || !options.online) return 'Pay at the venue. No online payment.'
  const names = options.providers.filter((p) => p.id !== 'test').map((p) => p.name)
  const via = names.length ? names.join(' or ') : 'online'
  return options.venue ? `Pay online with ${via}, or at the venue.` : `Pay online with ${via}.`
}

export const PROVIDER_BRAND: Record<string, { name: string; bg: string; fg: string; ring: string; mark: string }> = {
  khalti: { name: 'Khalti', bg: '#5C2D91', fg: '#ffffff', ring: '#5C2D91', mark: 'K' },
  esewa: { name: 'eSewa', bg: '#60BB46', fg: '#ffffff', ring: '#41A12F', mark: 'e' },
  test: { name: 'Test payment', bg: '#1C1724', fg: '#ffffff', ring: '#1C1724', mark: 'T' },
  venue: { name: 'At the venue', bg: '#F4F1F6', fg: '#1C1724', ring: '#9B94A6', mark: 'Rs' },
}

export const PAYMENT_STATUS_META: Record<OrderPaymentStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  paid: { label: 'Paid', tone: 'success' },
  due: { label: 'Pay at venue', tone: 'warning' },
  pending: { label: 'Awaiting payment', tone: 'info' },
  failed: { label: 'Not paid (released)', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'danger' },
  free: { label: 'Free', tone: 'neutral' },
}

/* ---------- organizer ---------- */

export interface EventPaymentSettings {
  payment_mode: PaymentOptions['mode']
  online_providers: ProviderId[]
  available_providers: ProviderInfo[]
  effective: PaymentOptions
  online_only_types: string[]
  platform_fee_percent: string
}

export interface OrderRow {
  id: string
  reference: string
  created_at: string
  buyer_name: string
  buyer_email: string
  buyer_phone: string
  ticket_count: number
  total: string
  promo_code: string | null
  payment: PaymentInfo
  payment_intent_id: string | null
  needs_attention: string | null
  notes: string
  tickets: { id: string; ticket_number: string; attendee_name: string; ticket_type_name: string; price: string; status: string }[]
}

export interface OrderTotals {
  orders: number
  online_collected: string
  online_orders: number
  venue_collected: string
  venue_paid_orders: number
  venue_due: string
  venue_due_orders: number
  pending_orders: number
  released_orders: number
  refunded: string
  refunded_orders: number
  free_orders: number
  needs_attention: number
}

export interface OrdersResponse {
  count: number
  results: OrderRow[]
  totals: OrderTotals
  filtered_totals: OrderTotals | null
  settings: EventPaymentSettings
}

export interface OrderFilters {
  status?: string
  method?: string
  provider?: string
  search?: string
  from?: string
  to?: string
  attention?: boolean
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface IntentRow {
  id: string
  purpose: string
  reference: string
  description: string
  status: IntentStatus
  amount: string
  provider: ProviderId | null
  provider_name: string | null
  provider_ref: string
  provider_txn_id: string
  platform_fee_percent: string
  platform_fee: string
  net_amount: string
  payer_name: string
  payer_email: string
  payer_phone: string
  event: { id: string; title: string } | null
  order_reference: string | null
  created_at: string
  paid_at: string | null
  refunded_at: string | null
  expires_at: string | null
  refund_note: string
  failure_reason: string
  organizer?: { id: string; name: string } | null
}

export interface IntentTotals {
  paid_count: number
  collected: string
  platform_fee: string
  net: string
  refunded_count: number
  refunded: string
  pending_count: number
  paid_out?: string
  owed?: string
}

export interface EventCollected {
  event: { id: string; title: string } | null
  payments: number
  collected: string
  platform_fee: string
  net: string
  paid_out: string
  owed: string
}

export interface PayoutRow {
  id: string
  amount: string
  method: string
  method_label: string
  reference: string
  note: string
  paid_on: string
  event: { id: string; title: string } | null
  organizer: { id: string; name: string }
  created_at: string
}

export interface OrganizerSummary {
  totals: IntentTotals & { paid_out: string; owed: string }
  events: EventCollected[]
  payouts: PayoutRow[]
  providers: ProviderInfo[]
  platform_fee_percent: string
  reservation_minutes: number
}

export interface ProviderStatus {
  id: string
  name: string
  enabled: boolean
  configured: boolean
  available: boolean
  sandbox: boolean
}

export interface AdminOverview {
  totals: IntentTotals & { paid_out: string; owed: string }
  by_provider: { provider: string; payments: number; collected: string }[]
  organizers: { organizer: { id: string; name: string }; payments: number; collected: string; platform_fee: string; net: string; paid_out: string; owed: string }[]
  providers: ProviderStatus[]
  module_enabled: boolean
  settings: { platform_fee_percent: string; reservation_minutes: number }
  needs_attention: IntentRow[]
}

export interface IntentFilters {
  event?: string
  status?: string
  provider?: string
  purpose?: string
  organizer?: string
  search?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

/** Download a CSV through the API (with the sign-in token) and save it. */
export async function downloadCsv(path: string, filename: string) {
  const token = tokenStore.access
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`Couldn't export (${res.status}). Try again.`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One of the signed-in payer's own payments (GET /api/payments/mine/). */
export interface PayerPayment {
  id: string
  purpose: string
  purpose_label: string
  description: string
  status: IntentStatus
  amount: string
  currency: string
  provider: ProviderId | null
  provider_name: string | null
  provider_txn_id: string | null
  event: { title: string; slug: string } | null
  created_at: string
  paid_at: string | null
  expires_at: string | null
  refunded: boolean
  refunded_at: string | null
  fulfilled: boolean
  failure_reason: string | null
  summary:
    | { type: 'ticket_order'; order_reference: string | null; ticket_count: number | null; tickets_issued: number; needs_attention: string | null }
    | { type: 'vote_pack'; votes: number | null; label: string | null; credited: boolean; auto_voted: number; contestant: string | null; contest: { title: string; slug: string; event_slug: string } | null }
    | { type: string }
    | null
}

export const paymentsApi = {
  intent: <R = unknown>(id: string) => request<PublicIntent<R>>(`/payments/intents/${id}/`),
  mine: (limit = 50, offset = 0) => request<{ count: number; results: PayerPayment[] }>(`/payments/mine/${qs({ limit, offset })}`),
  checkout: (id: string, provider: ProviderId) =>
    request<{ payment: PublicIntent; checkout: Checkout }>(`/payments/intents/${id}/checkout/`, { method: 'POST', body: JSON.stringify({ provider }) }),

  eventSettings: (eventId: string) => request<EventPaymentSettings>(`/payments/events/${eventId}/settings/`),
  saveEventSettings: (eventId: string, body: { payment_mode: PaymentOptions['mode']; online_providers: ProviderId[] }) =>
    request<EventPaymentSettings>(`/payments/events/${eventId}/settings/`, { method: 'PUT', body: JSON.stringify(body) }),

  orders: (eventId: string, f: OrderFilters = {}) => request<OrdersResponse>(`/events/${eventId}/orders/${qs({ ...f })}`),
  ordersCsvPath: (eventId: string, f: OrderFilters = {}) => `/events/${eventId}/orders/${qs({ ...f, export: 'csv' })}`,
  orderAction: (eventId: string, orderId: string, action: 'mark-paid' | 'mark-unpaid' | 'refund', note?: string) =>
    request<OrderRow>(`/events/${eventId}/orders/${orderId}/${action}/`, { method: 'POST', body: JSON.stringify({ note: note ?? '' }) }),

  organizerSummary: () => request<OrganizerSummary>('/payments/organizer/summary/'),
  organizerPayments: (f: IntentFilters = {}) =>
    request<{ count: number; results: IntentRow[]; totals: IntentTotals }>(`/payments/organizer/payments/${qs({ ...f })}`),
  organizerCsvPath: (f: IntentFilters = {}) => `/payments/organizer/payments/${qs({ ...f, export: 'csv' })}`,

  adminOverview: () => request<AdminOverview>('/payments/admin/overview/'),
  adminPayments: (f: IntentFilters = {}) =>
    request<{ count: number; results: IntentRow[]; totals: IntentTotals }>(`/payments/admin/payments/${qs({ ...f })}`),
  adminCsvPath: (f: IntentFilters = {}) => `/payments/admin/payments/${qs({ ...f, export: 'csv' })}`,
  adminRecheck: (id: string) => request<IntentRow>(`/payments/admin/payments/${id}/`, { method: 'POST' }),
  adminSettings: (body: { platform_fee_percent?: string; reservation_minutes?: number }) =>
    request<{ platform_fee_percent: string; reservation_minutes: number }>('/payments/admin/settings/', { method: 'PUT', body: JSON.stringify(body) }),
  adminPayouts: () => request<PayoutRow[]>('/payments/admin/payouts/'),
  addPayout: (body: { organizer: string; amount: string; method: string; reference?: string; note?: string; paid_on?: string; event?: string }) =>
    request<PayoutRow>('/payments/admin/payouts/', { method: 'POST', body: JSON.stringify(body) }),
  removePayout: (id: string) => request<void>(`/payments/admin/payouts/${id}/`, { method: 'DELETE' }),
}

export const rs = (v: string | number) => {
  const n = Number(v) || 0
  return `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

/** The payment line on a pass: per-ticket "Pay Rs 500 at the venue", or the order's "Paid online · Khalti · ref …". */
export function passPaymentLine(t: { price?: string; payment?: PaymentInfo | null }): { text: string; paid: boolean } | null {
  const p = t.payment
  if (p && p.status !== 'due') return { text: p.label, paid: p.status === 'paid' || p.status === 'free' }
  if (t.price === undefined) return null
  const due = Number(t.price) > 0
  return { text: due ? `Pay Rs ${Number(t.price).toLocaleString('en-IN')} at the venue` : 'Free', paid: !due }
}
