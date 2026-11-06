import { request, type Vendor, type VenueInquiry, type VenueWithSpaces } from '@/services/api'
import type { InquirySlot } from '@/lib/availability'
import type { InquiryStatus } from './status'

export type OwnedVenue = VenueWithSpaces
export type OwnedVendorProfile = Vendor

export interface MyListings {
  venues: OwnedVenue[]
  vendor_profiles: OwnedVendorProfile[]
}

export type BusinessInquiry = Required<Pick<VenueInquiry, 'id' | 'venue' | 'venue_name' | 'created_at'>> &
  Omit<VenueInquiry, 'status'> & {
    space?: string | null
    space_name?: string | null
    status: InquiryStatus
    slot?: InquirySlot | null
    owner_note?: string
    updated_at?: string
  }

/** An inquiry sent to one of the signed-in vendor's service profiles. */
export interface VendorBusinessInquiry {
  id: string
  vendor: string
  vendor_name: string
  sender_name: string
  sender_email: string
  sender_phone: string
  event_type: string
  event_date: string | null
  budget_range: string
  message: string
  status: InquiryStatus
  slot?: InquirySlot | null
  owner_note?: string
  created_at: string
  updated_at?: string
}

export type BusinessType = 'venue' | 'sound_stage' | 'photo_video' | 'decoration' | 'catering' | 'other'

export const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'venue', label: 'Venue or party palace' },
  { value: 'sound_stage', label: 'Sound, lights and stage' },
  { value: 'photo_video', label: 'Photo and video' },
  { value: 'decoration', label: 'Decoration' },
  { value: 'catering', label: 'Catering' },
  { value: 'other', label: 'Something else' },
]

export interface AccessRequest {
  id: string
  business_name: string
  business_type: BusinessType
  business_type_display: string
  city: string
  phone: string
  note: string
  status: 'pending' | 'approved' | 'rejected'
  review_note: string
  created_at: string
  reviewed_at: string | null
}

export type AccessRequestInput = Pick<AccessRequest, 'business_name' | 'business_type' | 'city' | 'phone' | 'note'>

export type VendorProfileInput = Pick<
  Vendor,
  'business_name' | 'category' | 'city' | 'address' | 'phone' | 'email' | 'description' | 'starting_price' | 'portfolio_images'
>

const json = (body: unknown) => JSON.stringify(body)

export const businessApi = {
  myListings: () => request<MyListings>('/marketplace/my/listings/'),
  myInquiries: (bookingsOnly = false) => request<BusinessInquiry[]>(`/marketplace/my/inquiries/${bookingsOnly ? '?has_slot=1' : ''}`),
  setInquiryStatus: (id: string, status: InquiryStatus) =>
    request<BusinessInquiry>(`/marketplace/my/inquiries/${id}/`, { method: 'PATCH', body: json({ status }) }),

  myVendorInquiries: (bookingsOnly = false) =>
    request<VendorBusinessInquiry[]>(`/marketplace/my/vendor-inquiries/${bookingsOnly ? '?has_slot=1' : ''}`),
  setVendorInquiryStatus: (id: string, status: InquiryStatus) =>
    request<VendorBusinessInquiry>(`/marketplace/my/vendor-inquiries/${id}/`, { method: 'PATCH', body: json({ status }) }),

  getVendorProfile: (id: string) => request<OwnedVendorProfile>(`/marketplace/vendors/${encodeURIComponent(id)}/`),
  createVendorProfile: (body: VendorProfileInput) =>
    request<OwnedVendorProfile>('/marketplace/vendors/', { method: 'POST', body: json(body) }),
  updateVendorProfile: (id: string, body: Partial<VendorProfileInput>) =>
    request<OwnedVendorProfile>(`/marketplace/vendors/${id}/`, { method: 'PATCH', body: json(body) }),
  /** Pause (hide from the directory, refuse new requests) or resume a venue / service profile. */
  setListingPaused: (kind: 'venue' | 'vendor', id: string, isPaused: boolean) =>
    request<OwnedVenue | OwnedVendorProfile>(`/marketplace/${kind === 'venue' ? 'venues' : 'vendors'}/${id}/`, {
      method: 'PATCH',
      body: json({ is_paused: isPaused }),
    }),

  /** Latest access request, or null when the organizer never asked. */
  myAccessRequest: async () => {
    try {
      return await request<AccessRequest>('/marketplace/access-requests/mine/')
    } catch (err) {
      if (err instanceof Error && /not requested|404/i.test(err.message)) return null
      throw err
    }
  },
  requestAccess: (body: AccessRequestInput) =>
    request<AccessRequest>('/marketplace/access-requests/', { method: 'POST', body: json(body) }),
}

export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
