import type { PublicTicketType } from '@/lib/tickets'
import { TENANT_HOST } from '@/lib/tenant-host'

export type EventPhase = 'draft' | 'upcoming' | 'live' | 'ended' | 'cancelled'

const API_BASE = '/api'

export interface Event {
  id: string
  /** Event type slug and its display name ('' for none/other) */
  category?: string
  category_name?: string
  title: string
  slug: string
  description: string
  banner?: string
  location: string
  start_date: string
  start_time?: string
  end_date?: string
  end_time?: string
  capacity: number
  status: 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled'
  allow_registration: boolean
  registration_deadline?: string
  is_paid: boolean
  ticket_price: string
  registration_form?: string
  registration_form_title?: string
  registered_count: number
  checked_in_count: number
  /** Lifecycle, computed by the server from status + dates (Nepal time) */
  phase?: EventPhase
  registration_open?: boolean
  registration_closed_reason?: string | null
  /** Public event detail only: visible, active ticket types */
  ticket_types?: PublicTicketType[]
  /** Public event detail only */
  has_promo_codes?: boolean
  /** Most tickets one registration can get (organizer setting, 1–50) */
  max_tickets_per_order?: number
  /** Organizer setting: show attendees how many spots/tickets are left */
  show_spots_left?: boolean
  /** "Managed by" line next to the organizer (e.g. the agency running the event) */
  managed_by?: string
  managed_by_logo?: string
  show_managed_by?: boolean
  ticket_layout?: 'vertical' | 'landscape'
  /** Main event id when this is a sub-event (module sub_events) */
  parent?: string | null
  parent_title?: string | null
  /** Attendees see their seat number on the pass (module seat_numbers) */
  show_seat_number?: boolean
  /** Public responses: counts are blanked (capacity 0, spots_left null, ticket remaining null) */
  spots_hidden?: boolean
  /** Public responses: no spots left (also when counts are hidden) */
  is_full?: boolean
  /** Blue tick: the organizer was verified by Eventlaya */
  organizer_verified?: boolean
}

export interface FormField {
  id?: string
  field_type: 'text' | 'paragraph' | 'number' | 'email' | 'phone' | 'select' | 'radio' | 'checkbox' | 'date'
  label: string
  placeholder?: string
  help_text?: string
  required: boolean
  order: number
  options?: string[]
}

export interface DynamicForm {
  id: string
  title: string
  slug: string
  description?: string
  status: 'draft' | 'published' | 'archived'
  event?: string
  fields: FormField[]
}

export interface Ticket {
  id: string
  ticket_number: string
  qr_token: string
  attendee_name: string
  attendee_email: string
  attendee_phone?: string
  status: 'valid' | 'checked_in' | 'checked_out' | 'cancelled' | 'reserved'
  is_attended: boolean
  first_check_in?: string
  last_activity?: string
  created_at: string
  ticket_type?: string | null
  ticket_type_name?: string
  /** Ticket price after any promo, e.g. "250.00" */
  price?: string
  /** How the order is / was paid (online or at the venue); label e.g. "Paid online · Khalti · ref …" */
  payment?: import('@/lib/payments').PaymentInfo | null
  promo_code?: string | null
  /** Note for gate staff, e.g. "Check student ID" */
  gate_note?: string
  /** Order this pass was bought in, e.g. "ORD-7K2M9Q" (older passes have none) */
  order_reference?: string | null
  /** 0 = the buyer's own pass, 1.. = their guests */
  guest_number?: number
  /** '' when none, or hidden from attendees by the event */
  seat_number?: string
  /** Shape of the pass, set per event (default vertical) */
  pass_layout?: 'vertical' | 'landscape'
}

export interface RegisterItem {
  ticket_type_id?: string
  quantity: number
  /** Names for this item's tickets after the buyer's own (blank → "<Buyer> · Guest N") */
  guest_names?: string[]
}

export interface RegisterResult {
  message?: string
  /** Absent when payment_required (online checkout: passes come after the payment) */
  ticket: Ticket
  tickets?: Ticket[]
  order?: { id: string; reference: string; ticket_count: number; total: string; payment?: import('@/lib/payments').PaymentInfo }
  already_registered?: boolean
  payment_required?: boolean
  payment?: import('@/lib/payments').PublicIntent
  checkout?: import('@/lib/payments').Checkout
}

export interface ScanResult {
  result: 'success' | 'duplicate' | 'not_in' | 'invalid' | 'cancelled' | 'wrong_event' | 'early_date' | 'expired' | 'wrong_ticket_gate'
  message: string
  ticket?: Ticket
}

export interface GateStats {
  event_id: string
  event_title: string
  capacity: number
  total_registered: number
  currently_inside: number
  total_checked_out: number
  recent_scans: {
    id: string
    ticket_number: string
    attendee_name: string
    scan_type: 'gate_in' | 'gate_out'
    result: string
    gate_name: string
    scanned_at: string
  }[]
}

export interface Poll {
  id: string
  event: string
  title: string
  description: string
  is_active: boolean
  require_ticket: boolean
  candidates: {
    id: string
    name: string
    bio: string
    photo?: string
    vote_count: number
  }[]
  total_votes: number
}

export interface Vendor {
  id: string
  business_name: string
  /** Business logo URL ('' when not set) */
  logo?: string
  category: string
  category_name: string
  category_slug: string
  city: string
  address: string
  phone: string
  email: string
  description: string
  starting_price: string
  portfolio_images: string[]
  /** Cover photo ('' = use the first photo) */
  featured_image?: string
  is_verified: boolean
  is_featured: boolean
  rating: string
  /** Real review average (null when no reviews) and count of visible reviews */
  review_average?: number | null
  review_total?: number
  user?: string
  /** Marketplace review state; the public directory only returns 'approved'. */
  listing_status?: ListingStatus
  review_note?: string
  /** Owner switch: hidden from the directory and not taking new requests. */
  is_paused?: boolean
}

export type ListingStatus = 'pending' | 'approved' | 'rejected'

export interface VendorCategory {
  id: string
  name: string
  slug: string
  icon: string
  order: number
  is_active: boolean
  vendors_count: number
}

export interface Banner {
  id: string
  placement: 'marketplace'
  image: string
  /** Optional phone version; without it phones show `image` uncropped */
  image_mobile: string
  title: string
  link: string
  order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
}

export interface ServicePackage {
  id: string
  vendor: string | null
  venue: string | null
  name: string
  price: string
  price_unit: 'event' | 'day' | 'plate' | 'hour' | 'person'
  price_unit_display: string
  description: string
  inclusions: string[]
  max_guests: number | null
  image: string
  is_active: boolean
  order: number
}

export interface City {
  id: string
  name: string
  province: string
  order: number
  is_active: boolean
}

export interface VenueListing {
  id: string
  owner_name?: string
  name: string
  slug: string
  venue_type: 'banquet' | 'resort' | 'auditorium' | 'hotel' | 'open_ground' | 'community'
  venue_type_display?: string
  city: string
  address: string
  capacity_min: number
  capacity_max: number
  price_per_day: string | number
  amenities: string[]
  images: string[]
  /** Cover photo ('' = use the first photo) */
  featured_image?: string
  contact_person: string
  contact_phone: string
  contact_email: string
  description: string
  rules_policy: string
  is_verified: boolean
  is_featured: boolean
  rating: string | number
  review_count: number
  review_average?: number | null
  review_total?: number
  inquiries_count?: number
  listing_status?: ListingStatus
  review_note?: string
  /** Owner switch: hidden from the directory and not taking new requests. */
  is_paused?: boolean
  created_at?: string
}

export interface VenueInquiry {
  id?: string
  venue?: string
  venue_name?: string
  sender_name: string
  sender_email: string
  sender_phone: string
  event_type: string
  event_date: string
  guest_count: number
  budget_range?: string
  message: string
  status?: string
  created_at?: string
  /** Package the request is about (module packages) */
  package?: string | null
  package_name?: string | null
}

export interface TenantBranding {
  id?: string
  subdomain: string
  custom_domain?: string
  cname_target?: string
  is_domain_verified: boolean
  ssl_active: boolean
  brand_name: string
  brand_logo: string
  primary_color: string
  accent_color: string
  custom_css?: string
  support_email: string
  footer_text: string
  remove_watermark: boolean
  is_whitelabel?: boolean
  /** GET/POST /auth/tenant-branding/: whether white-label is approved, and the live domain status */
  approved?: boolean
  status?: TenantDomainStatus
}

export interface TenantDnsRecord {
  type: 'CNAME' | 'TXT'
  /** Full record name, e.g. event.dharanfilmfestival.org */
  name: string
  /** What most DNS panels want in the Name box, e.g. "event" */
  host: string
  value: string
  purpose: string
}

/** apps.accounts.domains.domain_status */
export interface TenantDomainStatus {
  active: boolean
  module_enabled: boolean
  mode: 'cloudflare' | 'manual'
  subdomain: { host: string | null; url: string | null; available: boolean; live: boolean }
  custom_domain: null | {
    host: string
    url: string
    /** none → dns → ssl → live */
    stage: 'none' | 'dns' | 'ssl' | 'live'
    live: boolean
    dns_status: 'none' | 'pending' | 'verified' | 'failed'
    dns_verified: boolean
    dns_message: string
    dns_checked_at: string | null
    verified_at: string | null
    ssl_active: boolean
    ssl_provider: string
    provider_hostname_id: string
    provider_status: string
    provider_ssl_status: string
    provider_message: string
    provider_synced_at: string | null
    records: TenantDnsRecord[]
  }
  site_url: string | null
}

export interface DomainCheckResult {
  message: string
  is_domain_verified: boolean
  ssl_active: boolean
  cname_target: string
  status: TenantDomainStatus
}

/** GET /auth/tenant-branding/resolve/ — which white-label site this host is */
export interface ResolvedTenant extends Partial<TenantBranding> {
  is_whitelabel: boolean
  state: 'platform' | 'live' | 'not_set_up' | 'unavailable'
  host: string
  organizer_name?: string
  counts?: { live: number; upcoming: number; past: number }
}

export interface EventAnalytics {
  event: {
    id: string
    title: string
    slug: string
    capacity: number
    is_paid: boolean
    ticket_price: number
  }
  ticket_types?: {
    id: string
    name: string
    price: string
    quantity: number | null
    sold: number
    checked_in: number
    revenue: string
    availability: string
    is_hidden: boolean
  }[]
  attendance: {
    capacity: number
    total_registered: number
    checked_in: number
    currently_inside: number
    checked_out: number
    checkin_rate_pct: number
  }
  velocity_chart: {
    labels: string[]
    gate_in: number[]
    gate_out: number[]
  }
  gate_distribution_chart: {
    labels: string[]
    counts: number[]
  }
  registration_growth_chart: {
    labels: string[]
    counts: number[]
  }
  scan_audit: Record<string, number>
  funding: {
    target_budget: number
    sponsorship_raised: number
    ticket_sales_revenue: number
    grants_donations: number
    total_funding: number
    total_expenses: number
    net_balance: number
    expenses_breakdown: Record<string, number>
  }
  task_stats: {
    total: number
    todo: number
    in_progress: number
    completed: number
    urgent: number
  }
}

export interface EventFundingData {
  id?: string
  event: string
  target_budget: number | string
  sponsorship_raised: number | string
  ticket_sales_revenue: number | string
  grants_donations: number | string
  total_funding?: number | string
  expense_venue: number | string
  expense_catering: number | string
  expense_production: number | string
  expense_marketing: number | string
  expense_prizes_gifts: number | string
  expense_logistics: number | string
  total_expenses?: number | string
  net_balance?: number | string
}

export interface EventTask {
  id: string
  event: string
  event_title?: string
  title: string
  description?: string
  assigned_to?: string
  assigned_email?: string
  assigned_name: string
  status: 'todo' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  category: 'stage' | 'gate' | 'hospitality' | 'marketing' | 'catering' | 'tech'
  due_time?: string
  created_at: string
}

export interface AuthUser {
  id: string
  username: string
  email: string
  phone?: string
  role: 'superadmin' | 'organizer' | 'staff' | 'attendee' | 'vendor'
  organization_name?: string
  avatar?: string | null
  /** Whether the account may run a marketplace business portal. Vendors are always 'approved'. */
  marketplace_access?: 'none' | 'pending' | 'approved' | 'rejected'
  first_name?: string
  last_name?: string
  full_name?: string
  city?: string
  business_type?: string
  email_verified?: boolean
  email_verified_at?: string | null
  /** False for Google/Facebook accounts that never set a password */
  has_password?: boolean
  social_providers?: ('google' | 'facebook')[]
  date_joined?: string
  /** Blue tick, set by a platform admin */
  is_verified?: boolean
  /** A platform admin gave out a temporary password: the app sends them to change it first */
  must_change_password?: boolean
}

// Token storage. "Remember me" keeps tokens in localStorage; otherwise in sessionStorage,
// so closing the browser signs the user out.
const ACCESS = 'access_token'
const REFRESH = 'refresh_token'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

const stores = () => [safe(() => window.sessionStorage, null), safe(() => window.localStorage, null)].filter(Boolean) as Storage[]

export const tokenStore = {
  get access() {
    return safe(() => sessionStorage.getItem(ACCESS) ?? localStorage.getItem(ACCESS), null)
  },
  get refresh() {
    return safe(() => sessionStorage.getItem(REFRESH) ?? localStorage.getItem(REFRESH), null)
  },
  /** `remember` omitted (e.g. after a token refresh) keeps the tokens where they already are. */
  set(access: string, refresh?: string, remember?: boolean) {
    const remembered = remember ?? safe(() => sessionStorage.getItem(ACCESS) === null, true)
    tokenStore.clear()
    const target = safe(() => (remembered ? localStorage : sessionStorage), null)
    safe(() => {
      target?.setItem(ACCESS, access)
      if (refresh) target?.setItem(REFRESH, refresh)
    }, undefined)
  },
  clear() {
    for (const s of stores()) {
      safe(() => {
        s.removeItem(ACCESS)
        s.removeItem(REFRESH)
      }, undefined)
    }
  },
}

/** Fired when the session can't be refreshed, so the auth layer can sign the user out. */
export const AUTH_EXPIRED_EVENT = 'eventlaya:auth-expired'

let refreshing: Promise<boolean> | null = null

export async function refreshAccessToken(): Promise<boolean> {
  const refresh = tokenStore.refresh
  if (!refresh) return false
  refreshing ??= fetch(`${API_BASE}/auth/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  })
    .then(async (res) => {
      if (!res.ok) return false
      const data = await res.json()
      tokenStore.set(data.access, data.refresh ?? refresh)
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.error === 'string') return d.error
    if (typeof d.message === 'string') return d.message
    if (typeof d.detail === 'string') return d.detail
    // DRF field errors: { field: ["msg"] }
    const first = Object.entries(d)[0]
    if (first && Array.isArray(first[1]) && typeof first[1][0] === 'string') return `${first[0]}: ${first[1][0]}`
  }
  if (status >= 500) return 'The server hit an error. Try again in a moment.'
  return `Request failed (${status})`
}

/** Thrown by request(): the message is user-facing; status/code/data allow branching on specific errors. */
export class ApiError extends Error {
  status: number
  code?: string
  data: unknown
  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    const code = data && typeof data === 'object' ? (data as Record<string, unknown>).code : undefined
    this.code = typeof code === 'string' ? code : undefined
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code)
/** True when the server says the feature (module) is switched off for this account. */
export const isModuleDisabled = (e: unknown) => isApiError(e, 'module_disabled')

// Helpers
export async function request<T>(url: string, options: RequestInit = {}, retried = false): Promise<T> {
  const token = tokenStore.access
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // White-label site: the API scopes public events to this organization (apps.accounts.tenancy)
      ...(TENANT_HOST ? { 'X-Tenant-Host': TENANT_HOST } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401 && token && !retried) {
    if (await refreshAccessToken()) return request<T>(url, options, true)
    tokenStore.clear()
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status, data)
  return data as T
}

export const api = {
  // Auth
  login: (email: string, password: string, remember = true) =>
    request<{ access: string; refresh: string; user: AuthUser }>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
    }),
  requestPasswordReset: (email: string) =>
    request<{ message: string }>('/auth/password-reset/', { method: 'POST', body: JSON.stringify({ email }) }),
  checkPasswordResetLink: (uid: string, token: string) =>
    request<{ valid: boolean; email: string }>(`/auth/password-reset/confirm/?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`),
  confirmPasswordReset: (uid: string, token: string, new_password: string) =>
    request<{ message: string }>('/auth/password-reset/confirm/', { method: 'POST', body: JSON.stringify({ uid, token, new_password }) }),
  register: (body: {
    email: string
    password: string
    organization_name?: string
    phone?: string
    account_type?: 'organizer' | 'vendor' | 'attendee'
    business_type?: string
    city?: string
    first_name?: string
    last_name?: string
    /** The "I agree to the Terms of service and Privacy policy" box; the server refuses sign-ups without it. */
    terms: boolean
  }) =>
    request<AuthUser>('/auth/register/', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request<AuthUser>('/auth/me/'),

  // Events
  getEvents: () => request<Event[]>('/events/'),
  getPublicEvents: (params?: { when?: 'upcoming' | 'past' | 'all'; search?: string; city?: string; category?: string }) => {
    const q = new URLSearchParams()
    if (params?.when) q.append('when', params.when)
    if (params?.search) q.append('search', params.search)
    if (params?.city) q.append('city', params.city)
    if (params?.category) q.append('category', params.category)
    const str = q.toString()
    return request<(Event & { organizer_name?: string })[]>(`/events/public/${str ? `?${str}` : ''}`)
  },
  getPublicEvent: (slug: string) => request<{ event: Event; form: DynamicForm | null }>(`/events/public/${slug}/`),
  createEvent: (body: Partial<Event>) => request<Event>('/events/', { method: 'POST', body: JSON.stringify(body) }),
  updateEvent: (id: string, body: Partial<Event>) => request<Event>(`/events/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Gate Scanner
  scanTicket: (eventId: string, body: { qr_token: string; scan_type: 'gate_in' | 'gate_out'; gate_name?: string }) =>
    request<ScanResult>(`/events/${eventId}/gate/scan/`, { method: 'POST', body: JSON.stringify(body) }),
  getGateStats: (eventId: string) => request<GateStats>(`/events/${eventId}/gate/stats/`),
  getEventTickets: (eventId: string, search?: string) =>
    request<Ticket[]>(`/events/${eventId}/tickets/${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  // Dynamic Forms & Registration
  getForms: () => request<DynamicForm[]>('/forms/'),
  createForm: (body: Partial<DynamicForm>) => request<DynamicForm>('/forms/', { method: 'POST', body: JSON.stringify(body) }),
  createFormField: (body: Partial<FormField>) => request<FormField>('/forms/fields/', { method: 'POST', body: JSON.stringify(body) }),
  registerForEvent: (
    slug: string,
    body: {
      name: string
      email: string
      phone?: string
      answers?: Record<string, unknown>
      ticket_type_id?: string
      promo_code?: string
      items?: RegisterItem[]
      additional?: boolean
      /** Online: provider + the page to come back to after paying */
      payment_method?: 'venue' | 'online'
      provider?: string
      return_url?: string
    },
  ) =>
    request<RegisterResult>(`/forms/events/${slug}/register/`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Voting
  getPolls: (eventId?: string) => request<Poll[]>(`/voting/polls/${eventId ? `?event=${eventId}` : ''}`),
  castVote: (pollId: string, body: { candidate_id: string; voter_identifier?: string; ticket_token?: string }) =>
    request<{ message: string; candidate_id: string; new_vote_count: number }>(`/voting/polls/${pollId}/vote/`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Marketplace & Venues
  getCategories: () => request<VendorCategory[]>('/marketplace/categories/'),
  getCities: () => request<City[]>('/platform/cities/'),
  getPackages: (listing: { vendor?: string; venue?: string; mine?: boolean }) => {
    const q = new URLSearchParams()
    if (listing.vendor) q.set('vendor', listing.vendor)
    if (listing.venue) q.set('venue', listing.venue)
    if (listing.mine) q.set('mine', '1')
    return request<ServicePackage[]>(`/marketplace/packages/?${q}`)
  },
  savePackage: (p: Partial<ServicePackage>) =>
    request<ServicePackage>(p.id ? `/marketplace/packages/${p.id}/` : '/marketplace/packages/', {
      method: p.id ? 'PATCH' : 'POST',
      body: JSON.stringify(p),
    }),
  deletePackage: (id: string) => request<void>(`/marketplace/packages/${id}/`, { method: 'DELETE' }),
  assignSeats: (eventId: string, assignments: { ticket: string; seat: string }[]) =>
    request<{ updated: number; errors: { row: number | null; ticket: string; error: string }[] }>(`/events/${eventId}/seats/`, {
      method: 'POST',
      body: JSON.stringify({ assignments }),
    }),
  getBanners: (placement: Banner['placement']) => request<Banner[]>(`/platform/banners/?placement=${placement}`),
  getVendors: (params?: { category?: string; city?: string }) => {
    const q = new URLSearchParams()
    if (params?.category) q.append('category', params.category)
    if (params?.city) q.append('city', params.city)
    const str = q.toString()
    return request<Vendor[]>(`/marketplace/vendors/${str ? `?${str}` : ''}`)
  },
  getVenues: (params?: { city?: string; type?: string; min_capacity?: number; max_price?: number; search?: string }) => {
    const q = new URLSearchParams()
    if (params?.city) q.append('city', params.city)
    if (params?.type) q.append('type', params.type)
    if (params?.min_capacity) q.append('min_capacity', params.min_capacity.toString())
    if (params?.max_price) q.append('max_price', params.max_price.toString())
    if (params?.search) q.append('search', params.search)
    const str = q.toString()
    return request<VenueListing[]>(`/marketplace/venues/${str ? `?${str}` : ''}`)
  },
  createVenue: (body: Partial<VenueListing>) =>
    request<VenueListing>('/marketplace/venues/', { method: 'POST', body: JSON.stringify(body) }),
  sendVenueInquiry: (venueId: string, body: VenueInquiry) =>
    request<VenueInquiry>(`/marketplace/venues/${venueId}/inquiries/`, { method: 'POST', body: JSON.stringify(body) }),

  // White-Label Tenant Branding
  getTenantBranding: () => request<TenantBranding>('/auth/tenant-branding/'),
  updateTenantBranding: (body: Partial<TenantBranding>) =>
    request<TenantBranding>('/auth/tenant-branding/', { method: 'POST', body: JSON.stringify(body) }),
  verifyTenantDomain: () => request<DomainCheckResult>('/auth/tenant-branding/verify-domain/', { method: 'POST' }),
  resolveTenant: (host: string) => request<ResolvedTenant>(`/auth/tenant-branding/resolve/?host=${encodeURIComponent(host)}`),

  // Analytics & Financials
  getEventAnalytics: (eventId: string) => request<EventAnalytics>(`/events/${eventId}/analytics/`),
  getEventFunding: (eventId: string) => request<EventFundingData>(`/events/${eventId}/funding/`),
  updateEventFunding: (eventId: string, body: Partial<EventFundingData>) =>
    request<EventFundingData>(`/events/${eventId}/funding/`, { method: 'POST', body: JSON.stringify(body) }),

  // Work Distribution / Crew Tasks
  getEventTasks: (eventId: string, params?: { status?: string; priority?: string }) => {
    const q = new URLSearchParams()
    q.append('event_id', eventId)
    if (params?.status) q.append('status', params.status)
    if (params?.priority) q.append('priority', params.priority)
    return request<EventTask[]>(`/events/tasks/?${q.toString()}`)
  },
  createEventTask: (body: { event: string; title: string; description?: string; category?: string; priority?: string; assigned_name?: string; due_time?: string }) =>
    request<EventTask>('/events/tasks/', { method: 'POST', body: JSON.stringify(body) }),
  updateEventTask: (taskId: string, body: Partial<EventTask>) =>
    request<EventTask>(`/events/tasks/${taskId}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteEventTask: (taskId: string) =>
    request<{ message: string }>(`/events/tasks/${taskId}/`, { method: 'DELETE' }),
}

// ---------------------------------------------------------------------------
// Marketplace: venue spaces (halls, auditoriums, lawns inside one venue)

export interface VenueSpace {
  id: string
  venue?: string
  name: string
  space_type: 'hall' | 'auditorium' | 'lawn' | 'rooftop' | 'conference_room' | 'other'
  space_type_display?: string
  capacity_seated: number
  capacity_standing: number | null
  price_per_day: string | number
  area_sqft: number | null
  amenities: string[]
  images: string[]
  description: string
  is_active: boolean
  order: number
}

/** Venue as returned by the API, including its active spaces and derived "from" price. */
export type VenueWithSpaces = VenueListing & {
  owner?: string
  spaces?: VenueSpace[]
  price_from?: string
}

export type VenueSpaceInput = Omit<VenueSpace, 'id' | 'venue' | 'space_type_display'>

export const marketplaceApi = {
  getVenueBySlug: async (slug: string) => {
    const list = await request<VenueWithSpaces[]>(`/marketplace/venues/?slug=${encodeURIComponent(slug)}`)
    return list.find((v) => v.slug === slug) ?? null
  },
  createVenue: (body: Partial<VenueListing>) =>
    request<VenueWithSpaces>('/marketplace/venues/', { method: 'POST', body: JSON.stringify(body) }),
  updateVenue: (venueId: string, body: Partial<VenueListing>) =>
    request<VenueWithSpaces>(`/marketplace/venues/${venueId}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  getSpaces: (venueId: string) => request<VenueSpace[]>(`/marketplace/venues/${venueId}/spaces/`),
  createSpace: (venueId: string, body: VenueSpaceInput) =>
    request<VenueSpace>(`/marketplace/venues/${venueId}/spaces/`, { method: 'POST', body: JSON.stringify(body) }),
  updateSpace: (venueId: string, spaceId: string, body: Partial<VenueSpaceInput>) =>
    request<VenueSpace>(`/marketplace/venues/${venueId}/spaces/${spaceId}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSpace: (venueId: string, spaceId: string) =>
    request<void>(`/marketplace/venues/${venueId}/spaces/${spaceId}/`, { method: 'DELETE' }),
  sendInquiry: (venueId: string, body: VenueInquiry & { space?: string | null }) =>
    request<VenueInquiry>(`/marketplace/venues/${venueId}/inquiries/`, { method: 'POST', body: JSON.stringify(body) }),
}
