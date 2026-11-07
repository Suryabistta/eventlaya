import { request, type Banner, type City, type DomainCheckResult, type TenantDomainStatus, type VendorCategory } from '@/services/api'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type MarketplaceAccess = 'none' | 'pending' | 'approved' | 'rejected'

export interface PlatformStats {
  organizations: number
  vendors: number
  events_total: number
  events_published: number
  events_upcoming: number
  registrations_total: number
  checkins_total: number
  pending: { white_label: number; marketplace_access: number; listings: number }
  signups_by_day: { date: string; organizers: number; vendors: number }[]
  registrations_by_day: { date: string; count: number }[]
  top_organizations: { id: string; name: string; events: number; registrations: number }[]
}

export interface WhiteLabelRequest {
  id: string
  organizer: string
  organizer_email: string
  organizer_name: string
  requested_domain: string
  brand_name: string
  logo_url: string
  primary_color: string
  accent_color: string
  remove_watermark: boolean
  note: string
  status: ReviewStatus | 'revoked'
  review_note: string
  reviewed_by_email: string | null
  created_at: string
  reviewed_at: string | null
  tenant: {
    subdomain: string
    custom_domain: string | null
    is_domain_verified: boolean
    ssl_active: boolean
    status?: TenantDomainStatus
  } | null
}

export type WhiteLabelRequestInput = Pick<
  WhiteLabelRequest,
  'requested_domain' | 'brand_name' | 'logo_url' | 'primary_color' | 'accent_color' | 'remove_watermark' | 'note'
>

export interface MarketplaceAccessRequest {
  id: string
  user: string
  user_email: string
  user_name: string
  organization_name: string
  business_name: string
  business_type: string
  business_type_display: string
  city: string
  phone: string
  note: string
  status: ReviewStatus
  review_note: string
  reviewed_by_email: string | null
  created_at: string
  reviewed_at: string | null
}

export type ListingKind = 'venue' | 'vendor'

export interface ListingReview {
  kind: ListingKind
  id: string
  name: string
  slug: string | null
  subtitle: string
  city: string
  owner_id: string
  owner_email: string
  owner_name: string
  phone: string
  description: string
  image: string | null
  listing_status: ReviewStatus
  review_note: string
  public_url: string
  created_at: string
}

export interface Organization {
  id: string
  name: string
  email: string
  phone: string
  role: 'organizer' | 'vendor'
  marketplace_access: MarketplaceAccess
  is_active: boolean
  is_verified: boolean
  date_joined: string
  last_login: string | null
  events: number
  registrations: number
  plan: string | null
}

export interface OrganizationDetail extends Organization {
  checkins: number
  events_list: {
    id: string
    title: string
    slug: string
    status: 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled'
    start_date: string
    location: string
    registrations: number
    checkins: number
  }[]
  white_label: { status: ReviewStatus | 'none'; active: boolean; custom_domain: string | null; is_domain_verified: boolean }
  listings: { kind: ListingKind; id: string; name: string; status: ReviewStatus; is_verified: boolean }[]
  admin_actions: { kind: string; label: string; actor: string | null; note: string; at: string }[]
}

export interface NewOrganization {
  organization_name: string
  email: string
  role: 'organizer' | 'vendor'
  phone?: string
  city?: string
  is_verified?: boolean
}

/** Set-password link is only returned when the email couldn't be sent, so the admin can share it another way. */
export interface EmailedLink {
  email_sent: boolean
  set_password_link?: string
}

export interface ActivityItem {
  kind: string
  at: string
  title: string
  description: string
  link: string
}

export interface MarketplaceBusiness {
  id: string
  name: string
  email: string
  role: 'organizer' | 'vendor'
  is_active: boolean
  listings: { total: number; live: number; pending: number }
  inquiries: number
  business_name: string
  approved_at: string | null
  approved_by: string | null
}

export interface Segments {
  range: number
  by_type: {
    key: string
    label: string
    accounts: number
    active_accounts: number
    new_in_range: number
    events: number
    registrations: number
    listings: number
    linkable: boolean
  }[]
  by_city: { city: string; orgs: number; events: number; registrations: number; listings: number; other?: boolean }[]
  by_plan: {
    plan: string
    name: string
    orgs: number
    mrr: number
    mrr_share: number
    events: number
    registrations: number
    avg_events: number
    avg_registrations: number
  }[]
  growth: { week_start: string; organizer: number; both: number; vendor: number }[]
  engagement: { total: number; active: number; dormant: number; active_pct: number }
  marketplace: {
    listings_by_category: { kind: 'venue' | 'vendor'; label: string; approved: number; pending: number; rejected: number }[]
    inquiries_by_city: { city: string; count: number }[]
  }
}

export const post = <T>(url: string, body?: unknown) =>
  request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

export const platformApi = {
  stats: () => request<PlatformStats>('/platform/stats/'),

  // Cities & vendor categories (?all=1 includes inactive ones)
  cities: () => request<City[]>('/platform/cities/?all=1'),
  saveCity: (c: Partial<City>) => (c.id ? request<City>(`/platform/cities/${c.id}/`, json('PATCH', c)) : request<City>('/platform/cities/', json('POST', c))),
  deleteCity: (id: string) => request<void>(`/platform/cities/${id}/`, json('DELETE')),
  categories: () => request<VendorCategory[]>('/marketplace/categories/?all=1'),
  saveCategory: (c: Partial<VendorCategory>) =>
    c.id ? request<VendorCategory>(`/marketplace/categories/${c.id}/`, json('PATCH', c)) : request<VendorCategory>('/marketplace/categories/', json('POST', c)),
  deleteCategory: (id: string) => request<void>(`/marketplace/categories/${id}/`, json('DELETE')),
  banners: () => request<Banner[]>('/platform/banners/?all=1'),
  saveBanner: (b: Partial<Banner>) => (b.id ? request<Banner>(`/platform/banners/${b.id}/`, json('PATCH', b)) : request<Banner>('/platform/banners/', json('POST', b))),
  deleteBanner: (id: string) => request<void>(`/platform/banners/${id}/`, json('DELETE')),
  activity: () => request<ActivityItem[]>('/platform/activity/'),

  organizations: (params: { search?: string; type?: string; status?: string; city?: string; plan?: string }) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
    return request<Organization[]>(`/platform/organizations/?${q}`)
  },
  organization: (id: string) => request<OrganizationDetail>(`/platform/organizations/${id}/`),
  suspend: (id: string) => post<Organization>(`/platform/organizations/${id}/suspend/`),
  activate: (id: string) => post<Organization>(`/platform/organizations/${id}/activate/`),
  createOrganization: (body: NewOrganization) => post<EmailedLink & { id: string; name: string; email: string }>('/platform/organizations/', body),
  resetPassword: (id: string, mode: 'email' | 'temporary') =>
    post<EmailedLink & { message: string; temporary_password?: string }>(`/platform/organizations/${id}/reset-password/`, { mode }),
  verifyOrganization: (id: string, is_verified: boolean) => post<{ is_verified: boolean }>(`/platform/organizations/${id}/verify/`, { is_verified }),
  verifyListing: (kind: ListingKind, id: string, is_verified: boolean) =>
    request<unknown>(`/marketplace/${kind === 'venue' ? 'venues' : 'vendors'}/${id}/`, json('PATCH', { is_verified })),

  whiteLabelRequests: (status: ReviewStatus | 'revoked' | 'all' = 'pending') =>
    request<WhiteLabelRequest[]>(`/platform/white-label/requests/?status=${status}`),
  approveWhiteLabel: (id: string, note = '') => post<WhiteLabelRequest>(`/platform/white-label/requests/${id}/approve/`, { note }),
  rejectWhiteLabel: (id: string, note: string) => post<WhiteLabelRequest>(`/platform/white-label/requests/${id}/reject/`, { note }),
  revokeWhiteLabel: (id: string, note: string) => post<WhiteLabelRequest>(`/platform/white-label/requests/${id}/revoke/`, { note }),
  reopenWhiteLabel: (id: string) => post<WhiteLabelRequest>(`/platform/white-label/requests/${id}/reopen/`),
  checkWhiteLabelDomain: (id: string) => post<DomainCheckResult>(`/platform/white-label/requests/${id}/check-domain/`),

  marketplaceBusinesses: () => request<MarketplaceBusiness[]>('/platform/marketplace-businesses/'),
  revokeMarketplace: (userId: string, note: string) =>
    post<{ listings_hidden: number }>(`/platform/marketplace-businesses/${userId}/revoke/`, { note }),
  unpublishListing: (kind: ListingKind, id: string, note: string, to: 'pending' | 'rejected') =>
    post<unknown>(`/platform/listings/${kind}/${id}/unpublish/`, { note, to }),

  segments: (range: number) => request<Segments>(`/platform/segments/?range=${range}`),

  marketplaceRequests: (status: ReviewStatus | 'all' = 'pending') =>
    request<MarketplaceAccessRequest[]>(`/platform/marketplace-requests/?status=${status}`),
  approveMarketplace: (id: string, note = '') => post<unknown>(`/platform/marketplace-requests/${id}/approve/`, { note }),
  rejectMarketplace: (id: string, note: string) => post<unknown>(`/platform/marketplace-requests/${id}/reject/`, { note }),

  listings: (status: ReviewStatus | 'all' = 'pending', kind: ListingKind | 'all' = 'all') =>
    request<ListingReview[]>(`/platform/listings/?status=${status}&kind=${kind}`),
  approveListing: (kind: ListingKind, id: string, note = '') => post<unknown>(`/platform/listings/${kind}/${id}/approve/`, { note }),
  rejectListing: (kind: ListingKind, id: string, note: string) => post<unknown>(`/platform/listings/${kind}/${id}/reject/`, { note }),
}

/** Organizer-side white-label calls (used by /app/branding). */
export const whiteLabelApi = {
  mine: () => request<WhiteLabelRequest[]>('/platform/white-label/requests/mine/'),
  create: (body: WhiteLabelRequestInput) => post<WhiteLabelRequest>('/platform/white-label/requests/', body),
}

/** Shared with AppLayout's approvals badge, so approving here updates the sidebar count. */
export const STATS_KEY = ['platform-stats'] as const
