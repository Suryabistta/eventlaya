const API_BASE = '/api'

export interface Event {
  id: string
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
  status: 'valid' | 'checked_in' | 'checked_out' | 'cancelled'
  is_attended: boolean
  first_check_in?: string
  last_activity?: string
  created_at: string
}

export interface ScanResult {
  result: 'success' | 'duplicate' | 'not_in' | 'invalid' | 'cancelled' | 'wrong_event' | 'early_date' | 'expired'
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
  is_verified: boolean
  is_featured: boolean
  rating: string
}

export interface VendorCategory {
  id: string
  name: string
  slug: string
  icon: string
  vendors_count: number
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
  contact_person: string
  contact_phone: string
  contact_email: string
  description: string
  rules_policy: string
  is_verified: boolean
  is_featured: boolean
  rating: string | number
  review_count: number
  inquiries_count?: number
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

// Helpers
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('access_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      ...headers,
      ...options?.headers,
    },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || data.message || `Request failed with status ${res.status}`)
  }
  return data
}

export const api = {
  // Events
  getEvents: () => request<Event[]>('/events/'),
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
  registerForEvent: (slug: string, body: { name: string; email: string; phone?: string; answers?: Record<string, unknown> }) =>
    request<{ message: string; ticket: Ticket; form_response: unknown }>(`/forms/events/${slug}/register/`, {
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
  verifyTenantDomain: () =>
    request<{ message: string; is_domain_verified: boolean; ssl_active: boolean; cname_target: string }>('/auth/tenant-branding/verify-domain/', {
      method: 'POST',
    }),
  resolveTenant: (host: string) => request<TenantBranding>(`/auth/tenant-branding/resolve/?host=${encodeURIComponent(host)}`),

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
