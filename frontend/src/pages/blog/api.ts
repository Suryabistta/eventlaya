import { request } from '@/services/api'
import { formatDate } from '@/lib/dates'

export type BlogStatus = 'draft' | 'published' | 'scheduled'

export interface PostCard {
  slug: string
  title: string
  excerpt: string
  cover_image: string
  cover_alt: string
  category: string
  category_label: string
  tags: string[]
  cities: string[]
  author_name: string
  published_at: string | null
  updated_at: string
  reading_minutes: number
  /** 'en' or 'ne' (Nepali) */
  language: string
}

/** The same article in another language (for the language switch). */
export interface PostTranslation {
  language: string
  slug: string
  title: string
}

export interface TocItem {
  id: string
  title: string
  level: number
}

export interface FaqItem {
  q: string
  a: string
}

export interface PostDetail extends PostCard {
  body_html: string
  toc: TocItem[]
  faq: FaqItem[]
  word_count: number
  seo_title: string
  noindex: boolean
  translation_of: string
  translations: PostTranslation[]
  related: PostCard[]
}

export interface PostPage {
  results: PostCard[]
  count: number
  page: number
  pages: number
}

export interface Topics {
  languages?: { code: string; label: string; count: number }[]
  categories: { slug: string; label: string; count: number }[]
  tags: { name: string; count: number }[]
  cities: { name: string; count: number }[]
}

export interface AdminPost {
  id: string
  title: string
  slug: string
  excerpt: string
  body: string
  cover_image: string
  cover_alt: string
  category: string
  category_label?: string
  tags: string[]
  cities: string[]
  faq: FaqItem[]
  status: BlogStatus
  published_at: string | null
  author_name: string
  seo_title: string
  canonical_url: string
  noindex: boolean
  focus_keyword: string
  language?: string
  translation_of?: string
  body_html?: string
  toc?: TocItem[]
  word_count?: number
  reading_minutes?: number
  is_live?: boolean
  path?: string
  created_at?: string
  updated_at?: string
}

export interface Rendered {
  html: string
  toc: TocItem[]
  word_count: number
  reading_minutes: number
}

export interface EditorOptions {
  categories: { slug: string; label: string }[]
  cities: string[]
  languages?: { value: string; label: string }[]
  statuses: { value: BlogStatus; label: string }[]
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && s.set(k, String(v)))
  const str = s.toString()
  return str ? `?${str}` : ''
}

const json = (body: unknown) => JSON.stringify(body)

export const blogApi = {
  posts: (params: { search?: string; category?: string; tag?: string; city?: string; lang?: string; page?: number }) =>
    request<PostPage>(`/blog/posts/${qs(params)}`),
  post: (slug: string) => request<PostDetail>(`/blog/posts/${encodeURIComponent(slug)}/`),
  topics: () => request<Topics>('/blog/topics/'),
  // Superadmin
  adminList: (params: { status?: string; search?: string }) => request<AdminPost[]>(`/blog/admin/posts/${qs(params)}`),
  adminGet: (id: string) => request<AdminPost>(`/blog/admin/posts/${id}/`),
  adminCreate: (body: Partial<AdminPost>) => request<AdminPost>('/blog/admin/posts/', { method: 'POST', body: json(body) }),
  adminUpdate: (id: string, body: Partial<AdminPost>) =>
    request<AdminPost>(`/blog/admin/posts/${id}/`, { method: 'PATCH', body: json(body) }),
  adminDelete: (id: string) => request<void>(`/blog/admin/posts/${id}/`, { method: 'DELETE' }),
  preview: (body: string) => request<Rendered>('/blog/admin/preview/', { method: 'POST', body: json({ body }) }),
  options: () => request<EditorOptions>('/blog/admin/options/'),
}

const NE_MONTHS = ['जनवरी', 'फेब्रुअरी', 'मार्च', 'अप्रिल', 'मे', 'जुन', 'जुलाई', 'अगस्ट', 'सेप्टेम्बर', 'अक्टोबर', 'नोभेम्बर', 'डिसेम्बर']
const neDigits = (n: number) => String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[Number(d)])

export function formatPostDate(iso: string | null | undefined, language = 'en') {
  if (!iso) return ''
  const date = new Date(iso)
  // Written out by hand: not every browser ships Nepali locale data ("२८ अक्टोबर २०२६", AD date)
  if (language === 'ne') return `${neDigits(date.getDate())} ${NE_MONTHS[date.getMonth()]} ${neDigits(date.getFullYear())}`
  return formatDate(date, 'long')
}

/** Screen words of an article page in the article's language (the site itself stays English). */
export const POST_WORDS = {
  en: {
    by: 'By', published: 'Published', updated: 'Updated', minRead: (n: number) => `${n} min read`, inThisGuide: 'In this guide',
    faq: 'Frequently asked questions', topics: 'Topics', keepReading: 'Keep reading', allGuides: 'All guides',
    readIn: 'Read in English',
  },
  ne: {
    by: 'लेखक:', published: 'प्रकाशित', updated: 'अद्यावधिक', minRead: (n: number) => `${n} मिनेट पढ्न`, inThisGuide: 'यो लेखमा',
    faq: 'प्रायः सोधिने प्रश्नहरू', topics: 'विषयहरू', keepReading: 'थप पढ्नुहोस्', allGuides: 'सबै लेखहरू',
    readIn: 'नेपालीमा पढ्नुहोस्',
  },
} as const

export const postWords = (language: string | undefined) => POST_WORDS[language === 'ne' ? 'ne' : 'en']
export const LANGUAGE_NAMES: Record<string, string> = { en: 'English', ne: 'नेपाली' }
