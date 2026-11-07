import { request, type AuthUser, type EventPhase, type Ticket } from '@/services/api'
import type { InquirySlot } from './availability'

const json = (body: unknown) => JSON.stringify(body)

/* ------------------------------------------------------------ Email verification */

export interface SendCodeResponse {
  message: string
  email: string
  expires_in: number
  resend_available_in: number
}

export interface VerifyResponse {
  message: string
  linked_tickets: number
  user: AuthUser
}

/* ------------------------------------------------------------ My tickets */

export interface MyTicketEvent {
  id: string
  title: string
  slug: string
  tagline?: string
  category?: string
  banner: string | null
  location: string
  start_date: string
  start_time?: string | null
  end_date?: string | null
  end_time?: string | null
  starts_at?: string
  ends_at?: string
  status: string
  phase: EventPhase
  organizer_name: string
  organizer_verified?: boolean
}

export interface MyTicket extends Omit<Ticket, 'ticket_type'> {
  ticket_type: { id: string; name: string } | null
  event: MyTicketEvent
  my_review_id: string | null
  can_review: boolean
}

/* ------------------------------------------------------------ My inquiries */

export type InquiryState = 'pending' | 'contacted' | 'booked' | 'rejected' | 'cancelled'

export interface MySentInquiry {
  id: string
  kind: 'venue' | 'vendor'
  target: { id: string; name: string; slug: string | null; city: string; category?: string; image: string | null }
  space: { id: string; name: string } | null
  event_type: string
  event_date: string | null
  guest_count: number | null
  budget_range: string
  message: string
  status: InquiryState
  /** Set when this is a request for one of the listing's availability slots. */
  slot: InquirySlot | null
  /** Note the owner added when confirming or declining. */
  owner_note: string
  can_cancel: boolean
  created_at: string
  updated_at?: string
  my_review_id: string | null
  can_review: boolean
}

/* ------------------------------------------------------------ Profile */

export interface ProfileInput {
  first_name?: string
  last_name?: string
  phone?: string
  city?: string
  organization_name?: string
  /** Path from /api/uploads/ (kind=avatar); '' removes the photo */
  avatar_url?: string
}

export const accountApi = {
  sendCode: () => request<SendCodeResponse>('/auth/email/send-code/', { method: 'POST' }),
  verify: (code: string) => request<VerifyResponse>('/auth/email/verify/', { method: 'POST', body: json({ code }) }),

  myTickets: (when: 'upcoming' | 'past' | 'all' = 'all') =>
    request<{ count: number; results: MyTicket[] }>(`/me/tickets/?when=${when}`),
  myInquiries: () => request<{ count: number; results: MySentInquiry[] }>('/me/inquiries/'),

  updateProfile: (body: ProfileInput) => request<AuthUser>('/auth/me/', { method: 'PATCH', body: json(body) }),
  changePassword: (body: { current_password?: string; new_password: string }) =>
    request<{ message: string; has_password: boolean }>('/auth/password/', { method: 'POST', body: json(body) }),
  deleteAccount: (body: { password?: string; confirm?: boolean }) =>
    request<null>('/auth/me/', { method: 'DELETE', body: json(body) }),
}

/** Display name for the signed-in person. */
export const personName = (u: Pick<AuthUser, 'first_name' | 'last_name' | 'full_name' | 'organization_name' | 'username' | 'email' | 'role'>) =>
  (u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ')).trim() ||
  (u.role !== 'attendee' && u.organization_name) ||
  (u.username && !u.username.includes('@') ? u.username : '') ||
  u.email

/** "/media/…" as returned by the API: images are served from the same origin through the dev proxy. */
export const mediaUrl = (path?: string | null) => {
  if (!path) return null
  if (/^https?:\/\//.test(path) || path.startsWith('/')) return path
  return `/media/${path}`
}
