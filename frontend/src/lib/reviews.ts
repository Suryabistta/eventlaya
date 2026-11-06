import { request } from '@/services/api'

export type ReviewKind = 'event' | 'vendor' | 'venue'

export interface Review {
  id: string
  kind: ReviewKind
  target: { id: string; name: string; slug: string | null; image: string | null }
  rating: number
  text: string
  author: { name: string; avatar: string | null }
  reply: { text: string; replied_at: string } | null
  is_mine: boolean
  edited_at: string | null
  is_hidden: boolean
  /** Only for the author, the owner of what was reviewed, and admins */
  hidden_reason?: string
  created_at: string
  updated_at: string
}

export interface ReviewSummary {
  average: number | null
  count: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
}

export interface ReviewViewer {
  can_review: boolean
  /** Why the viewer can't review (null when they can, or already have) */
  reason: string | null
  my_review: Review | null
}

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export type TargetReviews = Page<Review> & { summary: ReviewSummary; viewer: ReviewViewer | null }

export interface ReviewInput {
  rating: number
  text?: string
}

const json = (body: unknown) => JSON.stringify(body)
const base = (kind: ReviewKind, key: string) => `/reviews/${kind}s/${encodeURIComponent(key)}/`

export const reviewsApi = {
  /** `key` is the event slug, or the vendor/venue id */
  forTarget: (kind: ReviewKind, key: string, page = 1) => request<TargetReviews>(`${base(kind, key)}?page=${page}`),
  create: (kind: ReviewKind, key: string, body: ReviewInput) => request<Review>(base(kind, key), { method: 'POST', body: json(body) }),
  update: (id: string, body: Partial<ReviewInput>) => request<Review>(`/reviews/${id}/`, { method: 'PATCH', body: json(body) }),
  remove: (id: string) => request<null>(`/reviews/${id}/`, { method: 'DELETE' }),
  get: (id: string) => request<Review>(`/reviews/${id}/`),
  mine: (page = 1) => request<Page<Review>>(`/reviews/mine/?page=${page}`),
  manage: (params: { kind?: ReviewKind | ''; event?: string; vendor?: string; venue?: string; hidden?: '1' | '0' | ''; page?: number }) => {
    const q = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.append(k, String(v)))
    return request<Page<Review>>(`/reviews/manage/?${q.toString()}`)
  },
  hide: (id: string, hidden: boolean, reason = '') => request<Review>(`/reviews/${id}/hide/`, { method: 'POST', body: json({ hidden, reason }) }),
  reply: (id: string, text: string) => request<Review>(`/reviews/${id}/reply/`, { method: 'POST', body: json({ text }) }),
  deleteReply: (id: string) => request<Review>(`/reviews/${id}/reply/`, { method: 'DELETE' }),
}

export const REVIEW_MAX = 1000

export const kindLabel: Record<ReviewKind, string> = { event: 'Event', vendor: 'Service', venue: 'Venue' }

/** Where the reviewed thing lives on the public site. */
export const targetHref = (r: Pick<Review, 'kind' | 'target'>) =>
  r.kind === 'event' ? `/e/${r.target.slug}` : r.kind === 'venue' ? `/marketplace/venues/${r.target.slug}` : `/marketplace/vendors/${r.target.id}`

export const fmtReviewDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
