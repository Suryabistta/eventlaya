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
  result: 'success' | 'duplicate' | 'not_in' | 'invalid' | 'cancelled'
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

// Helpers
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
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

  // Marketplace
  getCategories: () => request<VendorCategory[]>('/marketplace/categories/'),
  getVendors: (params?: { category?: string; city?: string }) => {
    const q = new URLSearchParams()
    if (params?.category) q.append('category', params.category)
    if (params?.city) q.append('city', params.city)
    const str = q.toString()
    return request<Vendor[]>(`/marketplace/vendors/${str ? `?${str}` : ''}`)
  },
}
